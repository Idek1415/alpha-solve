import { Context } from './context.model';

/**
 * Input data passed to a proc macro function
 * Currently has the same structure as CellFunctionInput
 */
export interface ProcMacroInput {
  latex: string;
  context: Context;
}

/**
 * Create a ProcMacroInput from cell and context data
 */
export function createProcMacroInput(latex: string, context: Context): ProcMacroInput {
  return {
    latex,
    context
  };
}


