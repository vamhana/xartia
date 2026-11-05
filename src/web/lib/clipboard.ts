// Copy-to-clipboard с fallback для insecure context (http://LAN-IP).
// navigator.clipboard доступен только в secure context (https/localhost),
// в http://192.168.x.x он undefined → старый код падал с TypeError.
// document.execCommand('copy') — deprecated, но работает везде.
export async function safeCopy(text: string): Promise<boolean> {
  // Быстрый путь: современный API (secure context).
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied / not focused — падаем в fallback
    }
  }
  // Fallback: скрытая textarea + execCommand('copy').
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}