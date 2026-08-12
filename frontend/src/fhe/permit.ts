import { useMemo } from "react";
import { useGrantPermit, useHasPermit } from "@zama-fhe/react-sdk";
import { SigningRejectedError } from "@zama-fhe/sdk";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { PermitDeclinedError } from "./decryption-machine";

export interface PermitAdapter {
  hasPermit(contractAddresses: readonly Address[]): Promise<boolean>;
  grantPermit(contractAddresses: readonly Address[]): Promise<void>;
}

export interface PermitGate {
  ensure(contractAddresses: readonly Address[]): Promise<void>;
}

export function normalizePermitError(error: unknown): unknown {
  return error instanceof SigningRejectedError ? new PermitDeclinedError() : error;
}

export function createPermitGate(adapter: PermitAdapter): PermitGate {
  const confirmed = new Set<string>();
  const pending = new Map<string, Promise<void>>();

  return {
    ensure(contractAddresses) {
      const key = contractAddresses
        .map((address) => address.toLowerCase())
        .sort()
        .join(":");
      if (confirmed.has(key)) return Promise.resolve();

      const current = pending.get(key);
      if (current !== undefined) return current;

      const request = (async () => {
        if (!(await adapter.hasPermit(contractAddresses))) {
          await adapter.grantPermit(contractAddresses);
        }
        confirmed.add(key);
      })().finally(() => {
        pending.delete(key);
      });

      pending.set(key, request);
      return request;
    },
  };
}

export function usePermitGate(contractAddresses: readonly Address[]): PermitGate {
  const addresses = useMemo(() => [...contractAddresses], [contractAddresses]);
  const account = useAccount().address;
  const permitQuery = useHasPermit({ contractAddresses: addresses });
  const grantPermit = useGrantPermit();
  const hasPermit = permitQuery.data;
  const refetchPermit = permitQuery.refetch;
  const grant = grantPermit.mutateAsync;

  return useMemo(
    () =>
      createPermitGate({
        async hasPermit() {
          if (hasPermit === true) return true;
          return (await refetchPermit()).data === true;
        },
        async grantPermit(requestedAddresses) {
          try {
            await grant([...requestedAddresses]);
          } catch (error) {
            throw normalizePermitError(error);
          }
        },
      }),
    [account, grant, hasPermit, refetchPermit],
  );
}
