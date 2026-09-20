import { Context, Variable } from './context.model';

/**
 * Result returned from a cell solution function
 */
export class CellFunctionResult {
  visibleSolutions?: string[];
  newContext?: Context;

  constructor(visibleSolutions?: string[], newContext?: Context) {
    this.visibleSolutions = visibleSolutions;
    this.newContext = newContext;
  }

  /**
   * Deserialize CellFunctionResult from JSON
   */
  static fromJSON(data: any): CellFunctionResult {
    let newContext: Context | undefined;

    if (data.new_context || data.newContext) {
      const contextData = data.new_context || data.newContext;

      // Convert variables array to Variable objects
      const variables = (contextData.variables || []).map((varData: any) =>
        Variable.fromJSON(varData)
      );

      newContext = {
        variables
      };
    }

    return new CellFunctionResult(
      data.visible_solutions || data.visibleSolutions,
      newContext
    );
  }

  /**
   * Serialize to JSON
   */
  toJSON(): object {
    const result: any = {};

    if (this.visibleSolutions) {
      result.visibleSolutions = this.visibleSolutions;
    }

    if (this.newContext) {
      result.newContext = {
        variables: this.newContext.variables.map(v => v.toJSON())
      };
    }

    return result;
  }
}

