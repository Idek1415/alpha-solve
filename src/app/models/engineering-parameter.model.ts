import { Context, Variable } from './context.model';
import { normalizeValueToSI } from './unit-system';

export type ParameterKind = 'input' | 'computed';
export type ParameterValueType = 'numerical' | 'analytical';

export interface EngineeringParameter {
  id: string;
  name: string;
  description: string;
  value: string;
  unit: string;
  kind: ParameterKind;
  valueType: ParameterValueType;
}

export function createEngineeringParameter(
  name: string,
  value: string,
  unit = '',
  description = '',
  kind: ParameterKind = 'input',
  valueType: ParameterValueType = 'numerical'
): EngineeringParameter {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    value,
    unit,
    kind,
    valueType
  };
}

export function parametersToContext(parameters: EngineeringParameter[]): Context {
  return {
    variables: parameters.map(parameter => {
      const normalized = normalizeValueToSI(parameter.value, parameter.unit);
      return new Variable(parameter.name, parameter.valueType, [normalized.value], normalized.unit);
    })
  };
}
