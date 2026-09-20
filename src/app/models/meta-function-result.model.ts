import { Dropdown } from './dropdown.model';

/**
 * Result returned from a meta function
 */
export class MetaFunctionResult {
  index: number;
  name: string;
  useResult: boolean;
  dropdowns?: Dropdown[];

  constructor(index: number, name: string, useResult: boolean = true, dropdowns?: Dropdown[]) {
    this.index = index;
    this.name = name;
    this.useResult = useResult;
    this.dropdowns = dropdowns;
  }

  /**
   * Deserialize MetaFunctionResult from JSON
   */
  static fromJSON(data: any): MetaFunctionResult {
    return new MetaFunctionResult(
      data.index,
      data.name,
      data.use_result !== undefined ? data.use_result : (data.useResult !== undefined ? data.useResult : true),
      data.dropdowns
    );
  }

  /**
   * Serialize to JSON
   */
  toJSON(): object {
    const result: any = {
      index: this.index,
      name: this.name,
      useResult: this.useResult
    };
    if (this.dropdowns) {
      result.dropdowns = this.dropdowns;
    }
    return result;
  }
}

