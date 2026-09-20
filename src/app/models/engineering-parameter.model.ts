import { Context, Variable } from './context.model';

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
    variables: parameters.map(parameter => new Variable(
      parameter.name,
      parameter.valueType,
      [parameter.value]
    ))
  };
}

