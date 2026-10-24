// F.4.01.01 — Корень приложения
// Провайдеры + роутинг. Защищённые страницы обёрнуты в Layout.


import { ExperimentsPage } from './pages/Experiments';
import { ConvergencePage } from './pages/Convergence';
import { QuantaPage } from './pages/Quanta';
import { AutomationPage } from './pages/Automation';
import { PsyPage } from './pages/Psy';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ChatPage } from './pages/chat';
import { Layout } from './components/layout/Layout';
import { Map } from './components/ui/Map';
import { useAuth } from './hooks/useAuth';
import { ChartDemoPage } from './pages/_ChartDemo';
import { FormDemoPage } from './pages/_FormDemo';
import { TableDemoPage } from './pages/_TableDemo';
import { ArchivePage } from './pages/Archive';
import { LoginPage } from './pages/auth/Login';
import { RegisterPage } from './pages/auth/Register';
import { WaitingRoomPage } from './pages/auth/WaitingRoom';
import { OtcPage } from './pages/Otc';
import { PassportPage } from './pages/Passport';
import { ReportPage } from './pages/Report';
import { WorkspacePage } from './pages/Workspace';
import { TasksPage } from './pages/Tasks';
import { DailyPlanPage } from './pages/DailyPlan';
import { NaryadPage } from './pages/Naryad';
import { PlanTreePage } from './pages/PlanTree';
import { SignalsPage } from './pages/Signals';
import { GoodsPage } from './pages/Goods';
import { FlowsPage } from './pages/Flows';
import { CellsPage } from './pages/Cells';
import { RegimesPage } from './pages/Regimes';
import { BalancePage } from './pages/Balance';
import { JuryPage } from './pages/Jury';
import { SemanticPage } from './pages/Semantic';
import { JusticePage } from './pages/Justice';
import { PlanetaryPage } from './pages/Planetary';
import { LearningPage } from './pages/Learning';
import { VerificationPage } from './pages/Verification';
import { GatewayPage } from './pages/Gateway';
import { ConstructorPage } from './pages/Constructor';
import { colors } from './theme';
import { StartPage } from './pages/Start';
import { CollectivePage } from './pages/Collective';
import { LandingPage } from './pages/Landing';
import {
  AdminLayout,
  DashboardPage,
  ParticipantsPage,
  MandatesPage,
  RecoveryPage,
  RequestsPage,
  LogsPage,
  SystemPage,
  WebhooksPage,
} from './pages/admin';

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
                <Layout><ConstructorPage /></Layout>
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
          <Route path="/map-demo" element={
            <RequireAuth><Layout>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h1>Map Demo</h1>
                <Map
                  center={[55.7558, 37.6173]}
                  zoom={10}
                  markers={[
                    { id: '1', lat: 55.7558, lon: 37.6173, label: 'Москва', type: 'community' },
                    { id: '2', lat: 55.7658, lon: 37.6273, label: 'Кризис', type: 'crisis' },
                  ]}
                  height={500}
                  showUserLocation
                />
              </div>
            </Layout></RequireAuth>
          } />
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