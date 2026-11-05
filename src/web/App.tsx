// F.4.01.01 — Корень приложения
// Провайдеры + роутинг. Защищённые страницы обёрнуты в Layout.


// ─── Eager: критичные для первого экрана / навигации ─────────────────
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/layout/Layout';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/auth/Login';
import { RegisterPage } from './pages/auth/Register';
import { WaitingRoomPage } from './pages/auth/WaitingRoom';
import { LandingPage } from './pages/Landing';
import { PassportPage } from './pages/Passport';
import { ReportPage } from './pages/Report';
import { StartPage } from './pages/Start';
import { TaskProfilePage } from './pages/TaskProfilePage';
// (eager оставляем только критичные; TeamCapability — lazy)
import { TasksPage } from './pages/Tasks';
import { colors } from './theme';

// ─── Lazy: тяжёлые / редко посещаемые страницы ───────────────────────
const ArchivePage = lazy(() => import('./pages/Archive').then((m) => ({ default: m.ArchivePage })));
const AutomationPage = lazy(() => import('./pages/Automation').then((m) => ({ default: m.AutomationPage })));
const BalancePage = lazy(() => import('./pages/Balance').then((m) => ({ default: m.BalancePage })));
const CellsPage = lazy(() => import('./pages/Cells').then((m) => ({ default: m.CellsPage })));
const CellsMapPage = lazy(() => import('./pages/CellsMap').then((m) => ({ default: m.CellsMapPage })));
const ChartDemoPage = lazy(() => import('./pages/_ChartDemo').then((m) => ({ default: m.ChartDemoPage })));
const ChatPage = lazy(() => import('./pages/chat').then((m) => ({ default: m.ChatPage })));
const CollectivePage = lazy(() => import('./pages/Collective').then((m) => ({ default: m.CollectivePage })));
const ConstructorPage = lazy(() => import('./pages/Constructor').then((m) => ({ default: m.ConstructorPage })));
const ConvergencePage = lazy(() => import('./pages/Convergence').then((m) => ({ default: m.ConvergencePage })));
const CouncilsPage = lazy(() => import('./pages/Councils').then((m) => ({ default: m.CouncilsPage })));
const DailyPlanPage = lazy(() => import('./pages/DailyPlan').then((m) => ({ default: m.DailyPlanPage })));
const ExperimentsPage = lazy(() => import('./pages/Experiments').then((m) => ({ default: m.ExperimentsPage })));
const FlowsPage = lazy(() => import('./pages/Flows').then((m) => ({ default: m.FlowsPage })));
const FormDemoPage = lazy(() => import('./pages/_FormDemo').then((m) => ({ default: m.FormDemoPage })));
const GatewayPage = lazy(() => import('./pages/Gateway').then((m) => ({ default: m.GatewayPage })));
const GoodsPage = lazy(() => import('./pages/Goods').then((m) => ({ default: m.GoodsPage })));
const JuryPage = lazy(() => import('./pages/Jury').then((m) => ({ default: m.JuryPage })));
const JusticePage = lazy(() => import('./pages/Justice').then((m) => ({ default: m.JusticePage })));
const LearningPage = lazy(() => import('./pages/Learning').then((m) => ({ default: m.LearningPage })));
const MapDemoPage = lazy(() => import('./pages/_MapDemo').then((m) => ({ default: m.MapDemoPage })));
const NaryadPage = lazy(() => import('./pages/Naryad').then((m) => ({ default: m.NaryadPage })));
const OtcPage = lazy(() => import('./pages/Otc').then((m) => ({ default: m.OtcPage })));
const PlanetaryPage = lazy(() => import('./pages/Planetary').then((m) => ({ default: m.PlanetaryPage })));
const PlanTreePage = lazy(() => import('./pages/PlanTree').then((m) => ({ default: m.PlanTreePage })));
const ProposalsPage = lazy(() => import('./pages/Proposals').then((m) => ({ default: m.ProposalsPage })));
const PsyPage = lazy(() => import('./pages/Psy').then((m) => ({ default: m.PsyPage })));
const QuantaPage = lazy(() => import('./pages/Quanta').then((m) => ({ default: m.QuantaPage })));
const RegimesPage = lazy(() => import('./pages/Regimes').then((m) => ({ default: m.RegimesPage })));
const SemanticPage = lazy(() => import('./pages/Semantic').then((m) => ({ default: m.SemanticPage })));
const SignalsPage = lazy(() => import('./pages/Signals').then((m) => ({ default: m.SignalsPage })));
const TableDemoPage = lazy(() => import('./pages/_TableDemo').then((m) => ({ default: m.TableDemoPage })));
const TreasuryPage = lazy(() => import('./pages/Treasury').then((m) => ({ default: m.TreasuryPage })));
const VerificationPage = lazy(() => import('./pages/Verification').then((m) => ({ default: m.VerificationPage })));
const WorkspacePage = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.WorkspacePage })));
const TeamsListPage = lazy(() => import('./pages/TeamsListPage').then((m) => ({ default: m.TeamsListPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })));
const CalibrationListPage = lazy(() => import('./pages/CalibrationListPage').then((m) => ({ default: m.CalibrationListPage })));
const CalibrationPage = lazy(() => import('./pages/CalibrationPage').then((m) => ({ default: m.CalibrationPage })));
const CatalogProposalPage = lazy(() => import('./pages/CatalogProposalPage').then((m) => ({ default: m.CatalogProposalPage })));
const CatalogProposalsListPage = lazy(() => import('./pages/CatalogProposalsListPage').then((m) => ({ default: m.CatalogProposalsListPage })));

// Admin — lazy через barrel (все страницы в одном чанке).
const AdminLayout = lazy(() =>
  import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const DashboardPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.DashboardPage })));
const ParticipantsPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.ParticipantsPage })));
const MandatesPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.MandatesPage })));
const RecoveryPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.RecoveryPage })));
const RequestsPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.RequestsPage })));
const LogsPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.LogsPage })));
const WebhooksPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.WebhooksPage })));
const SystemPage = lazy(() => import('./pages/admin').then((m) => ({ default: m.SystemPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});



// -------- Guard --------

/**
 * Корневой маршрут: показываем витрину неавторизованным и «Первый день»
 * авторизованным. Так приглашение по ссылке открывается объяснением, а не
 * формой логина.
 */
function RootPage(): ReactElement {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <div style={styles.loading}>Загрузка…</div>;
  }
  if (!isAuthenticated) {
    return <LandingPage />;
  }
  return (
    <Layout>
      <StartPage />
    </Layout>
  );
}

function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <div style={styles.loading}>Загрузка…</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// -------- App --------

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense
          fallback={
            <div style={styles.loading}>Загрузка…</div>
          }
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/waiting/:request_id" element={<WaitingRoomPage />} />

            {/* Корень: авторизованным — «Первый день», остальным — витрина. */}
            <Route path="/" element={<RootPage />} />
            <Route
              path="/start"
              element={
                <RequireAuth>
                  <Layout>
                    <StartPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/collective"
              element={
                <RequireAuth>
                  <Layout>
                    <CollectivePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/passport"
              element={
                <RequireAuth>
                  <Layout>
                    <PassportPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/teams"
              element={
                <RequireAuth>
                  <Layout>
                    <TeamsListPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/teams/:id"
              element={
                <RequireAuth>
                  <Layout>
                    <TeamPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/calibration"
              element={
                <RequireAuth>
                  <Layout>
                    <CalibrationListPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/calibration/:id"
              element={
                <RequireAuth>
                  <Layout>
                    <CalibrationPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/catalog/proposals"
              element={
                <RequireAuth>
                  <Layout>
                    <CatalogProposalsListPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/catalog/proposals/:id"
              element={
                <RequireAuth>
                  <Layout>
                    <CatalogProposalPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/tasks"
              element={
                <RequireAuth>
                  <Layout>
                    <TasksPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/tasks/:id/report"
              element={
                <RequireAuth>
                  <Layout>
                    <ReportPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/tasks/:id/profile"
              element={
                <RequireAuth>
                  <Layout>
                    <TaskProfilePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/signals"
              element={
                <RequireAuth>
                  <Layout>
                    <SignalsPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/goods"
              element={
                <RequireAuth>
                  <Layout>
                    <GoodsPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/otc"
              element={
                <RequireAuth>
                  <Layout>
                    <OtcPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/flows"
              element={
                <RequireAuth>
                  <Layout>
                    <FlowsPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/regimes"
              element={
                <RequireAuth>
                  <Layout>
                    <RegimesPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/council/daily-plan"
              element={
                <RequireAuth>
                  <Layout>
                    <DailyPlanPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/cells"
              element={
                <RequireAuth>
                  <Layout>
                    <CellsPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route path="/cells/map" element={<RequireAuth><Layout><CellsMapPage /></Layout></RequireAuth>} />
            <Route path="/proposals" element={<RequireAuth><Layout><ProposalsPage /></Layout></RequireAuth>} />
            <Route
              path="/archive"
              element={
                <RequireAuth>
                  <Layout>
                    <ArchivePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/balance"
              element={
                <RequireAuth>
                  <Layout>
                    <BalancePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/jury"
              element={
                <RequireAuth>
                  <Layout>
                    <JuryPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/semantic"
              element={
                <RequireAuth>
                  <Layout>
                    <SemanticPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/justice"
              element={
                <RequireAuth>
                  <Layout>
                    <JusticePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/automation"
              element={
                <RequireAuth>
                  <Layout>
                    <AutomationPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/psy"
              element={
                <RequireAuth>
                  <Layout>
                    <PsyPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/experiments"
              element={
                <RequireAuth>
                  <Layout>
                    <ExperimentsPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/convergence"
              element={
                <RequireAuth>
                  <Layout>
                    <ConvergencePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/quanta"
              element={
                <RequireAuth>
                  <Layout>
                    <QuantaPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/planetary"
              element={
                <RequireAuth>
                  <Layout>
                    <PlanetaryPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/learning"
              element={
                <RequireAuth>
                  <Layout>
                    <LearningPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/verification"
              element={
                <RequireAuth>
                  <Layout>
                    <VerificationPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/gateway"
              element={
                <RequireAuth>
                  <Layout>
                    <GatewayPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/constructor"
              element={
                <RequireAuth>
                  <Layout>
                    <ConstructorPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/workspace"
              element={
                <RequireAuth>
                  <Layout>
                    <WorkspacePage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <Layout>
                    <AdminLayout />
                  </Layout>
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="participants" element={<ParticipantsPage />} />
              <Route path="mandates" element={<MandatesPage />} />
              <Route path="recovery" element={<RecoveryPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="webhooks" element={<WebhooksPage />} />
              <Route path="system" element={<SystemPage />} />
            </Route>
            <Route
              path="/map-demo"
              element={
                <RequireAuth>
                  <Layout>
                    <MapDemoPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/treasury"
              element={<RequireAuth><Layout><TreasuryPage /></Layout></RequireAuth>}
            />
            <Route
              path="/councils"
              element={<RequireAuth><Layout><CouncilsPage /></Layout></RequireAuth>}
            />
            <Route
              path="/naryad"
              element={<RequireAuth><Layout><NaryadPage /></Layout></RequireAuth>}
            />
            <Route
              path="/plans/:id"
              element={<RequireAuth><Layout><PlanTreePage /></Layout></RequireAuth>}
            />
            <Route path="/chat" element={<RequireAuth><Layout><ChatPage /></Layout></RequireAuth>} />
            <Route
              path="/form-demo"
              element={
                <RequireAuth>
                  <Layout>
                    <FormDemoPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/table-demo"
              element={
                <RequireAuth>
                  <Layout>
                    <TableDemoPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route
              path="/chart-demo"
              element={
                <RequireAuth>
                  <Layout>
                    <ChartDemoPage />
                  </Layout>
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const styles = {
  loading: {
    minHeight: '100vh',
    background: colors.bg,
    color: colors.text,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    padding: 20,
  },
  h1: { marginTop: 0, marginBottom: 8, fontSize: 22 },
  muted: { color: colors.textMuted, margin: 0 },
};