#!/usr/bin/env python3
"""
Генератор эмблемы Хартии 5.0 — паспорт программиста (Направление 9).
... (шапка как в оригинале) ...
"""
import sys
import json
import math
import hashlib

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QLineEdit, QComboBox, QPushButton, QDoubleSpinBox,
    QFileDialog, QMessageBox, QGroupBox, QCheckBox,
    QGraphicsView, QGraphicsScene, QTextEdit
)
from PyQt6.QtCore import Qt, QByteArray
from PyQt6.QtGui import QPainter
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtSvgWidgets import QGraphicsSvgItem


# ============================================================
# ЦВЕТОВЫЕ ТЕМЫ
# ============================================================
THEMES = {
    "dark":   {"bg": "#1a1a1a", "line": "#e0e0e0", "node_stroke": "#e0e0e0",
               "fill_1": "#e0e0e0", "fill_2": "#e0e0e0"},
    "light":  {"bg": "#f5f5f5", "line": "#333333", "node_stroke": "#333333",
               "fill_1": "#333333", "fill_2": "#333333"},
    "gold":   {"bg": "#1a1200", "line": "#d4af37", "node_stroke": "#d4af37",
               "fill_1": "#d4af37", "fill_2": "#d4af37"},
    "copper": {"bg": "#1e1612", "line": "#b87333", "node_stroke": "#b87333",
               "fill_1": "#b87333", "fill_2": "#b87333"},
}

NODE_SKILLS = {
    0:  ("P01", "Архитектура"),
    1:  ("P02", "Декомпозиция"),
    2:  ("P03", "Безопасность"),
    3:  ("P04", "Производительность"),
    4:  ("P05", "Наставничество"),
    5:  ("P06", "Конкурентность"),
    6:  ("P07", "Базы данных"),
    7:  ("P08", "Качество кода"),
    8:  ("P09", "Тестирование"),
    9:  ("P10", "Отладка"),
    10: ("P11", "Алгоритмы"),
    11: ("P12", "Структуры данных"),
    12: ("P13", "Python"),
    13: ("P14", "SQL"),
    14: ("P15", "JS/TS"),
    15: ("P16", "Операционные системы"),
    16: ("P17", "Сети"),
    17: ("P18", "Железо"),
    18: ("P19", "Git"),
    19: ("P20", "Терминал"),
    20: ("P21", "Документация"),
}

TIER_COLORS = {
    "dark":   {0: "#2a2a2a", 1: "#8a6d1a", 2: "#1e5a23", 3: "#0d3d70", 4: "#b8860b"},
    "light":  {0: "#e0e0e0", 1: "#c9a227", 2: "#2e7d32", 3: "#1565c0", 4: "#7a5c00"},
    "gold":   {0: "#3a2f0a", 1: "#c9a227", 2: "#d4af37", 3: "#f0d060", 4: "#fff0a0"},
    "copper": {0: "#3a2818", 1: "#a06a20", 2: "#b87333", 3: "#d4915a", 4: "#f0b080"},
}


def get_tier(level: int) -> int:
    if level <= 0:
        return 0
    if level <= 3:
        return 1
    if level <= 5:
        return 2
    if level <= 7:
        return 3
    return 4


# ============================================================
# МАТЕМАТИЧЕСКАЯ МОДЕЛЬ
# ============================================================
A = 1.0
B = 0.6 * A
R = 0.075 * A
T = 0.04 * A
TOUT = 0.05 * A
OFFSET = 0.3 * A

NODES = [
    (-1.0,  3.0), ( 1.0,  3.0), (-2.0,  2.4), ( 0.0,  2.4), ( 2.0,  2.4),
    (-1.0,  1.8), ( 1.0,  1.8), (-2.0,  1.2), ( 0.0,  1.2), ( 2.0,  1.2),
    (-1.0,  0.6), ( 1.0,  0.6), (-2.0,  0.0), ( 0.0,  0.0), ( 2.0,  0.0),
    (-1.0, -0.6), ( 1.0, -0.6), ( 0.0, -1.2), (-1.0, -1.8), ( 1.0, -1.8),
    ( 0.0, -2.4),
]

EDGES = [
    (0,2), (0,3), (1,3), (1,4), (2,5), (3,5), (3,6), (4,6),
    (5,7), (5,8), (6,8), (6,9), (7,10), (8,10), (8,11), (9,11),
    (10,12), (10,13), (11,13), (11,14), (12,15), (13,15), (13,16),
    (14,16), (15,17), (16,17), (17,18), (17,19), (18,20), (19,20),
    (0,5), (1,6), (2,7), (3,8), (4,9), (5,10), (6,11), (7,12),
    (8,13), (9,14), (10,15), (11,16), (13,17), (15,18), (16,19), (17,20),
]

SIDE_DX_DY = 5.0 / 9.0
SIDE_ANGLE_DEG = math.degrees(math.atan(1.0 / SIDE_DX_DY))
INNER_APEX_ANGLE_DEG = 180.0 - 2.0 * SIDE_ANGLE_DEG


def left_side(y):
    return -2.0 * A - SIDE_DX_DY * y


def right_side(y):
    return 2.0 * A + SIDE_DX_DY * y


def left_dup(y):
    return left_side(y) - OFFSET


def right_dup(y):
    return right_side(y) + OFFSET


Y_TOP = 2.4 * A
TL = (left_side(Y_TOP), Y_TOP)
TR = (right_side(Y_TOP), Y_TOP)
TL_dup = (left_dup(Y_TOP), Y_TOP)
TR_dup = (right_dup(Y_TOP), Y_TOP)

GAP = 0.20 * A
HALF_GAP = GAP / 2.0
Y_BOTTOM = (1.0 / SIDE_DX_DY) * (HALF_GAP - 2.0 * A)
BL = (-HALF_GAP, Y_BOTTOM)
BR = (HALF_GAP, Y_BOTTOM)
BL_dup = (left_dup(Y_BOTTOM), Y_BOTTOM)
BR_dup = (right_dup(Y_BOTTOM), Y_BOTTOM)

IL = (BL_dup[0], (9.0 / 5.0) * (-2.0 * A - BL_dup[0]))
IR = (BR_dup[0], (9.0 / 5.0) * (BR_dup[0] - 2.0 * A))

TOP_BRIDGES_RAW = [(TL, NODES[2]), (NODES[4], TR)]
VERTICAL_LINES = [(TL, TL_dup), (TR, TR_dup)]


def clip_line(p1, p2, radius):
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    length = math.hypot(dx, dy)
    if length < 1e-12:
        return (p1[0], p1[1], p2[0], p2[1])
    ux = dx / length
    uy = dy / length
    return (p1[0] + radius * ux, p1[1] + radius * uy,
            p2[0] - radius * ux, p2[1] - radius * uy)


def clip_end(p1, p2, radius, is_p1_node, is_p2_node):
    x1, y1 = p1
    x2, y2 = p2
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy)
    if length < 1e-12:
        return (x1, y1, x2, y2)
    ux = dx / length
    uy = dy / length
    if is_p1_node:
        x1 += radius * ux
        y1 += radius * uy
    if is_p2_node:
        x2 -= radius * ux
        y2 -= radius * uy
    return (x1, y1, x2, y2)


ARC_R1 = 3.0 * A
ARC_R2 = 3.25 * A
TOP_START = 77.0
TOP_END = 103.0


def arc_coords(radius, start_deg, end_deg):
    start = math.radians(start_deg)
    end = math.radians(end_deg)
    return (radius * math.cos(start), radius * math.sin(start),
            radius * math.cos(end),   radius * math.sin(end))


def compute_intersection_angles(radius):
    qa = 106.0
    qb = 180.0
    qc = 324.0 - 81.0 * radius * radius
    disc = qb * qb - 4.0 * qa * qc
    if disc < 0:
        return None
    sqrt_d = math.sqrt(disc)
    y1 = (-qb + sqrt_d) / (2.0 * qa)
    y2 = (-qb - sqrt_d) / (2.0 * qa)
    y_upper = max(y1, y2)
    y_lower = min(y1, y2)
    x_left_upper = left_side(y_upper)
    x_left_lower = left_side(y_lower)
    left_upper = math.degrees(math.atan2(y_upper, x_left_upper)) % 360.0
    left_lower = math.degrees(math.atan2(y_lower, x_left_lower)) % 360.0
    x_right_upper = right_side(y_upper)
    x_right_lower = right_side(y_lower)
    right_upper = math.degrees(math.atan2(y_upper, x_right_upper)) % 360.0
    right_lower = math.degrees(math.atan2(y_lower, x_right_lower)) % 360.0
    return {"left": (left_upper, left_lower), "right": (right_upper, right_lower)}


def render_skill_node(cx, cy, r, level, theme, confidence=0.5,
                      active=False, task_requirement=None,
                      stroke_w=1.0):
    colors = THEMES[theme]
    tier_colors = TIER_COLORS[theme]
    fill_color = tier_colors[get_tier(level)]
    stroke_color = colors["node_stroke"]
    parts = []

    if level <= 0:
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" '
            f'stroke="{stroke_color}" stroke-width="{stroke_w}"/>'
        )
    elif level >= 9:
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill_color}" '
            f'stroke="{stroke_color}" stroke-width="{stroke_w}"/>'
        )
    else:
        fill_angle = 360.0 * level / 9.0
        start_rad = math.radians(90.0)
        end_rad = math.radians(90.0 - fill_angle)
        x1 = cx + r * math.cos(start_rad)
        y1 = cy + r * math.sin(start_rad)
        x2 = cx + r * math.cos(end_rad)
        y2 = cy + r * math.sin(end_rad)
        large_arc = 1 if fill_angle > 180 else 0
        path = f'M {cx} {cy} L {x1} {y1} A {r} {r} 0 {large_arc} 0 {x2} {y2} Z'
        parts.append(f'<path d="{path}" fill="{fill_color}" stroke="none"/>')
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" '
            f'stroke="{stroke_color}" stroke-width="{stroke_w}"/>'
        )

    if confidence < 0.5:
        dash = r * 0.15
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r * 1.3}" fill="none" '
            f'stroke="{stroke_color}" stroke-width="{stroke_w * 0.5}" '
            f'stroke-dasharray="{dash} {dash}" opacity="0.6"/>'
        )
    elif confidence >= 0.8:
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r * 1.25}" fill="none" '
            f'stroke="{fill_color}" stroke-width="{stroke_w * 0.4}" opacity="0.7"/>'
        )

    if level >= 6:
        parts.append(
            f'<circle cx="{cx}" cy="{cy + r * 0.85}" r="{r * 0.15}" '
            f'fill="{fill_color}"/>'
        )

    if active:
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r * 0.25}" fill="{stroke_color}"/>'
        )

    if task_requirement is not None:
        if level >= task_requirement:
            ring = "#00cc44"
        elif level >= task_requirement - 1:
            ring = "#ffaa00"
        else:
            ring = "#ff3333"
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r * 1.45}" fill="none" '
            f'stroke="{ring}" stroke-width="{stroke_w * 0.7}"/>'
        )

    return "\n".join(parts)


def render_legend(x, y_top, theme, item_r, spacing, font_size=None):
    colors = THEMES[theme]
    if font_size is None:
        font_size = item_r * 1.15
    items = [
        (0, "0 — нет"),
        (2, "1–3 — начальный"),
        (4, "4–5 — компетентен"),
        (6, "6–7 — опытный"),
        (8, "8–9 — мастер"),
    ]
    out = []
    for i, (lvl, label) in enumerate(items):
        cy = y_top - i * spacing
        out.append(render_skill_node(
            x, cy, item_r, lvl, theme,
            confidence=0.9, stroke_w=item_r * 0.18
        ))
        tx = x + item_r * 2.0
        out.append(
            f'<text transform="scale(1,-1) translate(0,{-2 * cy})" '
            f'x="{tx}" y="{cy}" font-size="{font_size}" '
            f'dominant-baseline="central" fill="{colors["line"]}" '
            f'stroke="{colors["bg"]}" stroke-width="{font_size * 0.18}" '
            f'paint-order="stroke fill">{label}</text>'
        )
    return "\n".join(out)


# ============================================================
# ГЕНЕРАЦИЯ SVG
# ============================================================
def generate_svg_data(id_val, theme="dark", scale=1.0, offset_deg=9.0,
                      with_metadata=True,
                      skill_levels=None, confidence=None,
                      active_skills=None, task_requirements=None,
                      show_labels=False, with_legend=True):
    colors = THEMES.get(theme, THEMES["dark"])
    use_passport = skill_levels is not None
    use_task = use_passport and task_requirements is not None

    if isinstance(id_val, str):
        id_num = int(hashlib.sha256(id_val.encode()).hexdigest(), 16) % (3 ** 21)
    else:
        id_num = id_val

    ternary = ""
    tmp = id_num
    for _ in range(21):
        ternary = str(tmp % 3) + ternary
        tmp //= 3
    ternary = ternary.zfill(21)

    def s(x, y):
        return (x * scale, y * scale)

    nodes_scaled = [s(x, y) for x, y in NODES]
    r_scaled = 2.0 * R * scale
    t_scaled = T * scale
    tout_scaled = TOUT * scale

    edges_clipped = []
    for i, j in EDGES:
        edges_clipped.append(clip_line(nodes_scaled[i], nodes_scaled[j], r_scaled))

    TL_s = s(*TL)
    TR_s = s(*TR)
    TL_dup_s = s(*TL_dup)
    TR_dup_s = s(*TR_dup)
    BL_dup_s = s(*BL_dup)
    BR_dup_s = s(*BR_dup)
    IL_s = s(*IL)
    IR_s = s(*IR)

    left_segments = [
        (TL_s, nodes_scaled[12]),
        (nodes_scaled[12], nodes_scaled[18]),
        (nodes_scaled[18], IL_s),
    ]
    right_segments = [
        (TR_s, nodes_scaled[14]),
        (nodes_scaled[14], nodes_scaled[19]),
        (nodes_scaled[19], IR_s),
    ]

    node_set = set(nodes_scaled)

    def make_side_lines(segments):
        out = []
        for p1, p2 in segments:
            out.append(clip_end(p1, p2, r_scaled,
                                p1 in node_set, p2 in node_set))
        return out

    left_side_lines = make_side_lines(left_segments)
    right_side_lines = make_side_lines(right_segments)

    top_bridges_clipped = []
    for p1, p2 in TOP_BRIDGES_RAW:
        p1s = s(*p1)
        p2s = s(*p2)
        top_bridges_clipped.append(
            clip_end(p1s, p2s, r_scaled, p1s in node_set, p2s in node_set)
        )

    vert_lines_scaled = [(s(*p1), s(*p2)) for p1, p2 in VERTICAL_LINES]

    arc_segments = []
    for radius in (ARC_R1, ARC_R2):
        x1, y1, x2, y2 = arc_coords(radius, TOP_START, TOP_END)
        arc_segments.append((x1 * scale, y1 * scale, x2 * scale, y2 * scale,
                             radius * scale))
    for radius in (ARC_R1, ARC_R2):
        angles = compute_intersection_angles(radius)
        if angles is None:
            continue
        left_upper, left_lower = angles["left"]
        x1, y1, x2, y2 = arc_coords(radius, left_upper + offset_deg,
                                    left_lower - offset_deg)
        arc_segments.append((x1 * scale, y1 * scale, x2 * scale, y2 * scale,
                             radius * scale))
        right_upper, right_lower = angles["right"]
        x1, y1, x2, y2 = arc_coords(radius, right_lower + offset_deg,
                                    right_upper - offset_deg + 360.0)
        arc_segments.append((x1 * scale, y1 * scale, x2 * scale, y2 * scale,
                             radius * scale))

    all_x = [TL_s[0], TR_s[0], TL_dup_s[0], TR_dup_s[0],
             BL_dup_s[0], BR_dup_s[0], IL_s[0], IR_s[0]]
    all_y = [TL_s[1], TR_s[1], TL_dup_s[1], TR_dup_s[1],
             BL_dup_s[1], BR_dup_s[1], IL_s[1], IR_s[1]]
    margin = 1.0 * scale
    max_x = max(abs(max(all_x)), abs(min(all_x)), 3.5 * scale) + margin
    max_y = max(abs(max(all_y)), abs(min(all_y)), 4.5 * scale) + margin
    view_size = 2.0 * max(max_x, max_y)
    view_x = -max_x
    view_y = -max_y

    # ---- Сборка SVG ----
    svg = []
    svg.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{view_size}" height="{view_size}" '
        f'viewBox="{view_x} {view_y} {view_size} {view_size}">'
    )
    svg.append(
        f'  <rect x="{view_x}" y="{view_y}" width="{view_size}" '
        f'height="{view_size}" fill="{colors["bg"]}" />'
    )
    svg.append('  <g transform="scale(1, -1)">')

    # 1. Внутренние боковые грани (сегменты)
    for x1, y1, x2, y2 in left_side_lines + right_side_lines:
        svg.append(
            f'    <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{colors["line"]}" stroke-width="{tout_scaled}" />'
        )

    # 2. Внешние боковые грани
    svg.append(
        f'    <line x1="{TL_dup_s[0]}" y1="{TL_dup_s[1]}" '
        f'x2="{BL_dup_s[0]}" y2="{BL_dup_s[1]}" '
        f'stroke="{colors["line"]}" stroke-width="{tout_scaled}" opacity="0.8" />'
    )
    svg.append(
        f'    <line x1="{TR_dup_s[0]}" y1="{TR_dup_s[1]}" '
        f'x2="{BR_dup_s[0]}" y2="{BR_dup_s[1]}" '
        f'stroke="{colors["line"]}" stroke-width="{tout_scaled}" opacity="0.8" />'
    )

    # 3. Вертикальные отсекающие рёбра
    svg.append(
        f'    <line x1="{BL_dup_s[0]}" y1="{BL_dup_s[1]}" '
        f'x2="{IL_s[0]}" y2="{IL_s[1]}" '
        f'stroke="{colors["line"]}" stroke-width="{t_scaled}" />'
    )
    svg.append(
        f'    <line x1="{BR_dup_s[0]}" y1="{BR_dup_s[1]}" '
        f'x2="{IR_s[0]}" y2="{IR_s[1]}" '
        f'stroke="{colors["line"]}" stroke-width="{t_scaled}" />'
    )

    # 4. Верхние вертикали TL->TL_dup, TR->TR_dup
    for (x1, y1), (x2, y2) in vert_lines_scaled:
        svg.append(
            f'    <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{colors["line"]}" stroke-width="{t_scaled}" />'
        )

    # 5. Верхние перемычки
    for x1, y1, x2, y2 in top_bridges_clipped:
        svg.append(
            f'    <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{colors["line"]}" stroke-width="{tout_scaled}" />'
        )

    # 6. Дуги
    for x1, y1, x2, y2, radius in arc_segments:
        svg.append(
            f'    <path d="M {x1} {y1} A {radius} {radius} 0 0 1 {x2} {y2}" '
            f'fill="none" stroke="{colors["line"]}" '
            f'stroke-width="{tout_scaled}" />'
        )

    # 7. Рёбра сети
    for x1, y1, x2, y2 in edges_clipped:
        svg.append(
            f'    <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{colors["line"]}" stroke-width="{t_scaled}" />'
        )

    # 8. Узлы
    if use_passport:
        conf = confidence or {}
        act = active_skills or set()
        req = task_requirements or {}
        task_idxs = set(req.keys())

        for idx, (x, y) in enumerate(nodes_scaled):
            lvl = skill_levels.get(idx, 0)
            c = conf.get(idx, 0.5)
            is_active = idx in act
            req_val = req.get(idx)
            dim = use_task and (idx not in task_idxs)

            node_svg = render_skill_node(
                x, y, r_scaled, lvl, theme,
                confidence=c, active=is_active,
                task_requirement=req_val,
                stroke_w=t_scaled,
            )
            if dim:
                svg.append(f'    <g opacity="0.25">{node_svg}</g>')
            else:
                svg.append(f'    {node_svg}')

            if show_labels:
                font_size = r_scaled * 0.85
                svg.append(
                    f'    <text transform="scale(1,-1) translate(0,{-2 * y})" '
                    f'x="{x}" y="{y}" font-size="{font_size}" '
                    f'text-anchor="middle" dominant-baseline="central" '
                    f'fill="{colors["line"]}" stroke="{colors["bg"]}" '
                    f'stroke-width="{font_size * 0.18}" '
                    f'paint-order="stroke fill">{lvl}</text>'
                )
    else:
        # ternary
        for idx, (x, y) in enumerate(nodes_scaled):
            state = int(ternary[idx])
            if state == 0:
                svg.append(
                    f'    <circle cx="{x}" cy="{y}" r="{r_scaled}" '
                    f'fill="none" stroke="{colors["node_stroke"]}" '
                    f'stroke-width="{t_scaled}" />'
                )
            elif state == 1:
                svg.append(
                    f'    <circle cx="{x}" cy="{y}" r="{r_scaled}" '
                    f'fill="{colors["fill_1"]}" '
                    f'stroke="{colors["node_stroke"]}" '
                    f'stroke-width="{t_scaled}" />'
                )
            else:
                svg.append(
                    f'    <circle cx="{x}" cy="{y}" r="{r_scaled}" '
                    f'fill="none" stroke="{colors["node_stroke"]}" '
                    f'stroke-width="{t_scaled}" />'
                )
                svg.append(
                    f'    <circle cx="{x}" cy="{y}" r="{r_scaled * 0.3}" '
                    f'fill="{colors["fill_2"]}" />'
                )

    # 9. Легенда (в passport/task)
    if with_legend and use_passport:
        legend_x = view_x + margin
        legend_item_r = 0.15 * scale
        legend_spacing = 0.4 * scale
        legend_y_bottom = -(view_y + view_size) + margin
        legend_y_top = legend_y_bottom + 4 * legend_spacing
        legend_svg = render_legend(
            legend_x, legend_y_top, theme,
            legend_item_r, legend_spacing,
            font_size=0.22 * scale,
        )
        svg.append(f'    {legend_svg}')

    svg.append('  </g>')

    if with_metadata:
        svg.append(f'  <!-- ID: {id_num} (ternary: {ternary}) -->')
        mode_tag = "passport" if use_passport else "ternary"
        if use_task:
            mode_tag += "+task"
        svg.append(f'  <!-- mode: {mode_tag}, theme: {theme}, scale: {scale} -->')
        if use_passport:
            levels_summary = ", ".join(
                f'{NODE_SKILLS[i][0]}={skill_levels.get(i, 0)}' for i in range(21)
            )
            svg.append(f'  <!-- levels: {levels_summary} -->')
        if use_task:
            task_summary = ", ".join(
                f'{NODE_SKILLS[i][0]}>={v}' for i, v in task_requirements.items()
            )
            svg.append(f'  <!-- task: {task_summary} -->')

    svg.append('</svg>')
    return '\n'.join(svg)


# ============================================================
# GUI
# ============================================================
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Паспорт программиста — Хартия 5.0")
        self.setMinimumSize(1200, 820)
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)

        control = QWidget()
        control.setFixedWidth(400)
        clayout = QVBoxLayout(control)
        clayout.setSpacing(8)

        g_id = QGroupBox("ID участника")
        v = QVBoxLayout(g_id)
        self.id_input = QLineEdit()
        self.id_input.setText("Г12345-9")
        self.id_input.setPlaceholderText("число или строка")
        v.addWidget(self.id_input)
        self.hash_cb = QCheckBox("Хешировать строку в число")
        self.hash_cb.setChecked(True)
        v.addWidget(self.hash_cb)
        clayout.addWidget(g_id)

        g_mode = QGroupBox("Режим")
        v = QVBoxLayout(g_mode)
        self.mode_combo = QComboBox()
        self.mode_combo.addItems(["passport", "task", "ternary"])
        self.mode_combo.setCurrentText("passport")
        v.addWidget(self.mode_combo)
        clayout.addWidget(g_mode)

        row = QHBoxLayout()
        g_theme = QGroupBox("Тема")
        v = QVBoxLayout(g_theme)
        self.theme_combo = QComboBox()
        self.theme_combo.addItems(list(THEMES.keys()))
        self.theme_combo.setCurrentText("dark")
        v.addWidget(self.theme_combo)
        row.addWidget(g_theme)

        g_scale = QGroupBox("Масштаб")
        v = QVBoxLayout(g_scale)
        self.scale_spin = QDoubleSpinBox()
        self.scale_spin.setRange(0.5, 50.0)
        self.scale_spin.setValue(8.0)
        self.scale_spin.setSingleStep(0.5)
        v.addWidget(self.scale_spin)
        row.addWidget(g_scale)

        g_offset = QGroupBox("Отступ дуг°")
        v = QVBoxLayout(g_offset)
        self.offset_spin = QDoubleSpinBox()
        self.offset_spin.setRange(0.0, 20.0)
        self.offset_spin.setValue(9.0)
        self.offset_spin.setSingleStep(0.5)
        v.addWidget(self.offset_spin)
        row.addWidget(g_offset)
        clayout.addLayout(row)

        g_skills = QGroupBox("Уровни навыков (JSON: {индекс: 0-9})")
        v = QVBoxLayout(g_skills)
        self.skills_edit = QTextEdit()
        self.skills_edit.setMaximumHeight(75)
        self.skills_edit.setPlainText(
            '{"0":3,"1":4,"2":2,"3":3,"4":2,"5":4,"6":5,"7":5,"8":4,"9":5,'
            '"10":4,"11":5,"12":6,"13":5,"14":2,"15":3,"16":3,"17":2,'
            '"18":6,"19":5,"20":4}'
        )
        v.addWidget(self.skills_edit)
        clayout.addWidget(g_skills)

        g_conf = QGroupBox("Уверенность (JSON: {индекс: 0-1})")
        v = QVBoxLayout(g_conf)
        self.conf_edit = QTextEdit()
        self.conf_edit.setMaximumHeight(65)
        self.conf_edit.setPlainText(
            '{"0":0.9,"1":0.85,"2":0.6,"3":0.7,"4":0.5,"5":0.8,"6":0.9,'
            '"7":0.9,"8":0.85,"9":0.9,"10":0.8,"11":0.9,"12":0.95,'
            '"13":0.9,"14":0.4,"15":0.3,"16":0.5,"17":0.3,"18":0.95,'
            '"19":0.9,"20":0.8}'
        )
        v.addWidget(self.conf_edit)
        clayout.addWidget(g_conf)

        g_active = QGroupBox("Активно развивается (индексы через запятую)")
        v = QVBoxLayout(g_active)
        self.active_input = QLineEdit()
        self.active_input.setText("13,15")
        v.addWidget(self.active_input)
        clayout.addWidget(g_active)

        g_task = QGroupBox("Требования задачи (JSON: {индекс: 0-9})")
        v = QVBoxLayout(g_task)
        self.task_edit = QTextEdit()
        self.task_edit.setMaximumHeight(60)
        self.task_edit.setPlainText('{"12":4,"13":3,"8":3,"7":3}')
        v.addWidget(self.task_edit)
        clayout.addWidget(g_task)

        g_opt = QGroupBox("Опции")
        v = QVBoxLayout(g_opt)
        self.show_labels_cb = QCheckBox("Показывать числа уровней")
        self.show_labels_cb.setChecked(True)
        v.addWidget(self.show_labels_cb)
        self.show_legend_cb = QCheckBox("Показывать легенду")
        self.show_legend_cb.setChecked(True)
        v.addWidget(self.show_legend_cb)
        clayout.addWidget(g_opt)

        self.gen_btn = QPushButton("Сгенерировать")
        self.gen_btn.clicked.connect(self.generate)
        clayout.addWidget(self.gen_btn)

        hbox = QHBoxLayout()
        self.save_svg_btn = QPushButton("Сохранить SVG")
        self.save_svg_btn.clicked.connect(self.save_svg)
        hbox.addWidget(self.save_svg_btn)
        self.save_png_btn = QPushButton("Сохранить PNG")
        self.save_png_btn.clicked.connect(self.save_png)
        hbox.addWidget(self.save_png_btn)
        clayout.addLayout(hbox)

        self.info_label = QLabel("Готов")
        self.info_label.setWordWrap(True)
        clayout.addWidget(self.info_label)
        clayout.addStretch()
        main_layout.addWidget(control)

        self.graphics_view = QGraphicsView()
        self.graphics_scene = QGraphicsScene()
        self.graphics_view.setScene(self.graphics_scene)
        self.graphics_view.setRenderHint(QPainter.RenderHint.Antialiasing)
        main_layout.addWidget(self.graphics_view, stretch=1)

        self.current_svg = None
        self.generate()

    def _parse_int_dict(self, text):
        data = json.loads(text) if text.strip() else {}
        return {int(k): int(v) for k, v in data.items()}

    def _parse_float_dict(self, text):
        data = json.loads(text) if text.strip() else {}
        return {int(k): float(v) for k, v in data.items()}

    def _parse_active(self, text):
        if not text.strip():
            return set()
        return {int(x.strip()) for x in text.split(",") if x.strip()}

    def generate(self):
        try:
            raw = self.id_input.text().strip()
            if not raw:
                QMessageBox.warning(self, "Ошибка", "Введите ID")
                return
            if self.hash_cb.isChecked():
                id_val = int(raw) if raw.isdigit() else raw
            else:
                if not raw.isdigit():
                    QMessageBox.warning(self, "Ошибка", "ID должен быть числом")
                    return
                id_val = int(raw)
            if isinstance(id_val, int) and (id_val < 0 or id_val >= 3 ** 21):
                QMessageBox.warning(self, "Ошибка",
                                    f"ID должен быть в [0, {3 ** 21 - 1}]")
                return

            mode = self.mode_combo.currentText()
            theme = self.theme_combo.currentText()
            scale = self.scale_spin.value()
            offset = self.offset_spin.value()
            show_labels = self.show_labels_cb.isChecked()
            show_legend = self.show_legend_cb.isChecked()

            skill_levels = None
            confidence = None
            active = None
            task_req = None
            if mode in ("passport", "task"):
                skill_levels = self._parse_int_dict(self.skills_edit.toPlainText())
                confidence = self._parse_float_dict(self.conf_edit.toPlainText())
                active = self._parse_active(self.active_input.text())
                if mode == "task":
                    task_req = self._parse_int_dict(self.task_edit.toPlainText())

            svg_data = generate_svg_data(
                id_val, theme=theme, scale=scale, offset_deg=offset,
                with_metadata=True,
                skill_levels=skill_levels,
                confidence=confidence,
                active_skills=active,
                task_requirements=task_req,
                show_labels=show_labels,
                with_legend=show_legend,
            )
            self.current_svg = svg_data

            renderer = QSvgRenderer(QByteArray(svg_data.encode()))
            self.graphics_scene.clear()
            item = QGraphicsSvgItem()
            item.setSharedRenderer(renderer)
            self.graphics_scene.addItem(item)
            self.graphics_view.fitInView(item, Qt.AspectRatioMode.KeepAspectRatio)

            self.info_label.setText(
                f"Режим: {mode}, тема: {theme}, масштаб: {scale}"
            )
        except json.JSONDecodeError as e:
            QMessageBox.critical(self, "Ошибка JSON", str(e))
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", str(e))

    def save_svg(self):
        if not self.current_svg:
            QMessageBox.warning(self, "Ошибка", "Сначала сгенерируйте")
            return
        filename, _ = QFileDialog.getSaveFileName(
            self, "Сохранить SVG", "", "SVG files (*.svg)"
        )
        if filename:
            with open(filename, "w", encoding="utf-8") as f:
                f.write(self.current_svg)
            self.info_label.setText(f"SVG: {filename}")

    def save_png(self):
        if not self.current_svg:
            QMessageBox.warning(self, "Ошибка", "Сначала сгенерируйте")
            return
        filename, _ = QFileDialog.getSaveFileName(
            self, "Сохранить PNG", "", "PNG files (*.png)"
        )
        if filename:
            try:
                import cairosvg
                import xml.etree.ElementTree as ET
                root = ET.fromstring(self.current_svg)
                w = int(float(root.get("width", "500")))
                h = int(float(root.get("height", "500")))
                cairosvg.svg2png(
                    bytestring=self.current_svg.encode(),
                    write_to=filename,
                    output_width=w * 2, output_height=h * 2,
                )
                self.info_label.setText(f"PNG: {filename}")
            except ImportError:
                QMessageBox.critical(self, "Ошибка",
                                     "Установите cairosvg: pip install cairosvg")
            except Exception as e:
                QMessageBox.critical(self, "Ошибка", str(e))


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())