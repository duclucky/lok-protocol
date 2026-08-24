import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { useLokPublicData } from "./features/public-data/useLokPublicData";
import { useLokTransactions } from "./features/transactions/useLokTransactions";
import { useLokWalletData } from "./features/wallet/useLokWalletData";
import { useLokPrivateValues } from "./fhe/useLokPrivateValues";
import { DepositPage } from "./pages/DepositPage";
import { DrawPage } from "./pages/DrawPage";
import { ProofPage } from "./pages/ProofPage";
import { RiskPage } from "./pages/RiskPage";
import { VaultPage } from "./pages/VaultPage";
import { WhyEncryptedPage } from "./pages/WhyEncryptedPage";

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
              <VaultPage
                publicData={publicData}
                revealBalance={privateValues.revealBalance}
                revealActionStatus={privateValues.revealActionStatus}
                withdrawAction={transactions}
              />
            }
          />
          <Route
            path="deposit"
            element={
              <DepositPage
                actions={transactions}
                revealActionStatus={privateValues.revealActionStatus}
                revealWalletCusdc={privateValues.revealWalletCusdc}
                walletData={walletData}
              />
            }
          />
          <Route path="risk" element={<RiskPage action={transactions} revealTheta={privateValues.revealTheta} />} />
          <Route path="draw" element={<DrawPage publicData={publicData} keeperAction={transactions} />} />
          <Route path="proof" element={<ProofPage drawId={drawId} revealCredit={privateValues.revealCredit} />} />
          <Route path="why-encrypted" element={<WhyEncryptedPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
