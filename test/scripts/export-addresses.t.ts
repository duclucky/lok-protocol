import { expect } from "chai";

import { renderAddressExport } from "../../scripts/export-addresses";

describe("frontend address exporter", function () {
  it("maps one Sepolia manifest to the six frontend variables", function () {
    const rendered = renderAddressExport({
      chainId: 11155111,
      addresses: {
        underlyingToken: "0x0000000000000000000000000000000000000011",
        confidentialToken: "0x0000000000000000000000000000000000000012",
        wrapper: "0x0000000000000000000000000000000000000012",
        yieldAdapter: "0x0000000000000000000000000000000000000013",
        vault: "0x0000000000000000000000000000000000000014",
        drawManager: "0x0000000000000000000000000000000000000015",
        guardian: null,
      },
    });

    expect(rendered).to.equal(
      [
        "VITE_LOK_VAULT_ADDRESS=0x0000000000000000000000000000000000000014",
        "VITE_LOK_DRAW_MANAGER_ADDRESS=0x0000000000000000000000000000000000000015",
        "VITE_CUSDC_ADDRESS=0x0000000000000000000000000000000000000012",
        "VITE_USDC_ADDRESS=0x0000000000000000000000000000000000000011",
        "VITE_WRAPPER_ADDRESS=0x0000000000000000000000000000000000000012",
        "VITE_YIELD_ADAPTER_ADDRESS=0x0000000000000000000000000000000000000013",
        "",
      ].join("\n"),
    );
  });
});
