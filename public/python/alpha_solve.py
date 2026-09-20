"""
Alpha Solve Python Library

This module provides Python classes that mirror the TypeScript models
used in the Alpha Solve application. Use these when writing plugin functions.
"""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict
import json


@dataclass
class Variable:
    """
    Variable class representing a named value with a type
    """
    name: str
    type: str  # 'numerical' or 'analytical'
    values: List[str]

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Variable':
        """Create a Variable from a dictionary"""
        return Variable(
            name=data['name'],
            type=data['type'],
            values=data['values']
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert Variable to dictionary"""
        return asdict(self)

    @staticmethod
    def create_numerical(name: str, values: List[str]) -> 'Variable':
        """Create a numerical variable"""
        return Variable(name=name, type='numerical', values=values)

    @staticmethod
    def create_analytical(name: str, values: List[str]) -> 'Variable':
        """Create an analytical variable"""
        return Variable(name=name, type='analytical', values=values)


@dataclass
class Context:
    """
    Context object containing variables
    """
    variables: List[Variable]

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'Context':
        """Create a Context from a dictionary"""
        variables = [Variable.from_dict(v) for v in data.get('variables', [])]
        return Context(variables=variables)

    def to_dict(self) -> Dict[str, Any]:
        """Convert Context to dictionary"""
        return {
            'variables': [v.to_dict() for v in self.variables]
        }

    def get_variable(self, name: str) -> Optional[Variable]:
        """Get a variable by name"""
        for var in self.variables:
            if var.name == name:
                return var
        return None

    def add_variable(self, variable: Variable) -> None:
        """Add a variable to the context"""
        self.variables.append(variable)

    def remove_variable(self, name: str) -> bool:
        """Remove a variable by name"""
        for i, var in enumerate(self.variables):
            if var.name == name:
                self.variables.pop(i)
                return True
        return False


@dataclass
class DropdownSelection:
    """
    User's selection from a dropdown
    """
    title: str
    selected_item: str

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'DropdownSelection':
        """Create DropdownSelection from a dictionary"""
        return DropdownSelection(
            title=data['title'],
            selected_item=data.get('selectedItem', data.get('selected_item', ''))
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert DropdownSelection to dictionary"""
        return {
            'title': self.title,
            'selected_item': self.selected_item
        }


@dataclass
class Dropdown:
    """
    Dropdown UI element that can be provided by meta functions
    """
    title: str
    items: List[str]

    def to_dict(self) -> Dict[str, Any]:
        """Convert Dropdown to dictionary"""
        return {
            'title': self.title,
            'items': self.items
        }


@dataclass
class CellFunctionInput:
    """
    Input structure passed to cell solution functions
    """
    cell: Dict[str, Any]
    context: Context
    dropdown_selections: Optional[List[DropdownSelection]] = None

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'CellFunctionInput':
        """Create CellFunctionInput from a dictionary"""
        dropdown_selections = None
        if 'dropdownSelections' in data or 'dropdown_selections' in data:
            selections_data = data.get('dropdownSelections', data.get('dropdown_selections', []))
            if selections_data:
                dropdown_selections = [DropdownSelection.from_dict(s) for s in selections_data]

        return CellFunctionInput(
            cell=data['cell'],
            context=Context.from_dict(data['context']),
            dropdown_selections=dropdown_selections
        )

    @staticmethod
    def from_json(json_str: str) -> 'CellFunctionInput':
        """Create CellFunctionInput from a JSON string"""
        data = json.loads(json_str)
        return CellFunctionInput.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Convert CellFunctionInput to dictionary"""
        result = {
            'cell': self.cell,
            'context': self.context.to_dict()
        }
        if self.dropdown_selections:
            result['dropdown_selections'] = [s.to_dict() for s in self.dropdown_selections]
        return result

    def get_dropdown_selection(self, title: str) -> Optional[str]:
        """Get the selected item for a dropdown by title"""
        if not self.dropdown_selections:
            return None
        for selection in self.dropdown_selections:
            if selection.title == title:
                return selection.selected_item
        return None


@dataclass
class CellFunctionResult:
    """
    Result returned from a cell solution function
    """
    visible_solutions: Optional[List[str]] = None
    new_context: Optional[Context] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert CellFunctionResult to dictionary"""
        result = {}
        if self.visible_solutions is not None:
            result['visible_solutions'] = self.visible_solutions
        if self.new_context is not None:
            result['new_context'] = self.new_context.to_dict()
        return result

    def to_json(self) -> str:
        """Convert CellFunctionResult to JSON string"""
        return json.dumps(self.to_dict())


@dataclass
class MetaFunctionResult:
    """
    Result returned from a meta function
    """
    index: int
    name: str
    use_result: bool = True
    dropdowns: Optional[List[Dropdown]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert MetaFunctionResult to dictionary"""
        result = {
            'index': self.index,
            'name': self.name,
            'use_result': self.use_result
        }
        if self.dropdowns:
            result['dropdowns'] = [d.to_dict() for d in self.dropdowns]
        return result

    def to_json(self) -> str:
        """Convert MetaFunctionResult to JSON string"""
        return json.dumps(self.to_dict())


@dataclass
class ProcMacroInput:
    """
    Input structure passed to proc macro functions
    """
    latex: str
    context: Context

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> 'ProcMacroInput':
        """Create ProcMacroInput from a dictionary"""
        return ProcMacroInput(
            latex=data['latex'],
            context=Context.from_dict(data['context'])
        )

    @staticmethod
    def from_json(json_str: str) -> 'ProcMacroInput':
        """Create ProcMacroInput from a JSON string"""
        data = json.loads(json_str)
        return ProcMacroInput.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Convert ProcMacroInput to dictionary"""
        return {
            'latex': self.latex,
            'context': self.context.to_dict()
        }


@dataclass
class ProcMacroResult:
    """
    Result returned from a proc macro function
    Contains modified LaTeX content that will be passed to cell solution functions
    """
    modified_latex: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert ProcMacroResult to dictionary"""
        return {
            'modified_latex': self.modified_latex
        }

    def to_json(self) -> str:
        """Convert ProcMacroResult to JSON string"""
        return json.dumps(self.to_dict())


# Helper functions

def create_context(variables: Optional[List[Variable]] = None) -> Context:
    """Create a new context with optional variables"""
    return Context(variables=variables or [])


def parse_input(json_str: str) -> CellFunctionInput:
    """
    Parse JSON input string into CellFunctionInput
    This is the main function to use at the start of your cell solution functions
    """
    return CellFunctionInput.from_json(json_str)


def parse_proc_macro_input(json_str: str) -> ProcMacroInput:
    """
    Parse JSON input string into ProcMacroInput
    This is the main function to use at the start of your proc macro functions
    """
    return ProcMacroInput.from_json(json_str)

