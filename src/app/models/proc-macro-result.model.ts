/**
 * Result from a proc macro function
 * Proc macros modify cell content before it's processed by cell solution functions
 */
export interface ProcMacroResultData {
  modified_latex: string; // New LaTeX content for the cell (required)
}

export class ProcMacroResult {
  modifiedLatex: string;

  constructor(modifiedLatex: string) {
    this.modifiedLatex = modifiedLatex;
  }

  /**
   * Create from JSON data (snake_case from Python)
   */
  static fromJSON(data: ProcMacroResultData): ProcMacroResult {
    return new ProcMacroResult(data.modified_latex);
  }

  /**
   * Convert to JSON data
   */
  toJSON(): ProcMacroResultData {
    return {
      modified_latex: this.modifiedLatex
    };
  }
}

