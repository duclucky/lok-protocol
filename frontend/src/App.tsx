import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { useLokPublicData } from "./features/public-data/useLokPublicData";
import { useLokTransactions } from "./features/transactions/useLokTransactions";
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
                withdrawAction={transactions}
              />
            }
          />
          <Route path="deposit" element={<DepositPage actions={transactions} />} />
          <Route path="risk" element={<RiskPage action={transactions} />} />
          <Route path="draw" element={<DrawPage publicData={publicData} />} />
          <Route
            path="proof"
            element={<ProofPage drawId={drawId} revealCredit={privateValues.revealCredit} />}
          />
          <Route path="why-encrypted" element={<WhyEncryptedPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
