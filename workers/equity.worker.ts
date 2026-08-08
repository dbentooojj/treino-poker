import { calculateEquity, type EquityInput, type EquityOptions, type EquityResult } from "../lib/poker/equity";

export type EquityWorkerRequest = {
  requestId: number;
  input: EquityInput;
  options: EquityOptions;
};

export type EquityWorkerResponse =
  | { requestId: number; ok: true; result: EquityResult }
  | { requestId: number; ok: false; error: string };

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<EquityWorkerRequest>) => void) | null;
  postMessage: (message: EquityWorkerResponse) => void;
};

workerScope.onmessage = ({ data }) => {
  try {
    const result = calculateEquity(data.input, data.options);
    workerScope.postMessage({ requestId: data.requestId, ok: true, result });
  } catch (error) {
    workerScope.postMessage({
      requestId: data.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível calcular a equity.",
    });
  }
};
