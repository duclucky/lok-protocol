import { lazy, Suspense, type PropsWithChildren } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { useLokPublicData } from "./features/public-data/useLokPublicData";
import { useLokTransactions } from "./features/transactions/useLokTransactions";
import { useLokWalletData } from "./features/wallet/useLokWalletData";
import { useLokPrivateValues } from "./fhe/useLokPrivateValues";
const DepositPage = lazy(async () => ({ default: (await import("./pages/DepositPage")).DepositPage }));
const DrawPage = lazy(async () => ({ default: (await import("./pages/DrawPage")).DrawPage }));
const ProofPage = lazy(async () => ({ default: (await import("./pages/ProofPage")).ProofPage }));
const RiskPage = lazy(async () => ({ default: (await import("./pages/RiskPage")).RiskPage }));
const VaultPage = lazy(async () => ({ default: (await import("./pages/VaultPage")).VaultPage }));
const WhyEncryptedPage = lazy(async () => ({
  default: (await import("./pages/WhyEncryptedPage")).WhyEncryptedPage,
}));

function RouteBoundary({ children }: PropsWithChildren) {
  return (
    <Suspense
      fallback={
        <section className="route-loading" role="status" aria-label="Loading route">
          Loading Lok Protocol...
        </section>
      }
    >
      {children}
    </Suspense>
  );
}

export function App() {
  const publicData = useLokPublicData();
  const transactions = useLokTransactions();
  const walletData = useLokWalletData();
  const drawId = publicData.status === "ready" ? publicData.snapshot.draw?.id : undefined;
  const privateValues = useLokPrivateValues(drawId);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <RouteBoundary>
                <VaultPage
                  publicData={publicData}
                  revealBalance={privateValues.revealBalance}
                  revealActionStatus={privateValues.revealActionStatus}
                  withdrawAction={transactions}
                />
              </RouteBoundary>
            }
          />
          <Route
            path="deposit"
            element={
              <RouteBoundary>
                <DepositPage
                  actions={transactions}
                  revealActionStatus={privateValues.revealActionStatus}
                  revealWalletCusdc={privateValues.revealWalletCusdc}
                  walletData={walletData}
                />
              </RouteBoundary>
            }
          />
          <Route
            path="risk"
            element={
              <RouteBoundary>
                <RiskPage action={transactions} revealTheta={privateValues.revealTheta} />
              </RouteBoundary>
            }
          />
          <Route
            path="draw"
            element={
              <RouteBoundary>
                <DrawPage publicData={publicData} keeperAction={transactions} />
              </RouteBoundary>
            }
          />
          <Route
            path="proof"
            element={
              <RouteBoundary>
                <ProofPage drawId={drawId} revealCredit={privateValues.revealCredit} />
              </RouteBoundary>
            }
          />
          <Route
            path="why-encrypted"
            element={
              <RouteBoundary>
                <WhyEncryptedPage />
              </RouteBoundary>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
