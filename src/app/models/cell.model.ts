import { Context, serializeContext, deserializeContext, createContext } from './context.model';
import { DropdownSelection, Dropdown } from './dropdown.model';

/**
 * Base interface for all cell types
 */
export interface BaseCell {
  id: string;
  type: 'equation' | 'folder' | 'note' | 'code';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cell containing a LaTeX equation
 */
export interface EquationCell extends BaseCell {
  type: 'equation';
  latex: string;
  context?: Context;
  solutions?: string[];
  dropdowns?: Dropdown[];
  dropdownSelections?: DropdownSelection[];
}

/**
 * Cell that acts as a folder containing other cells (recursive structure)
 */
export interface FolderCell extends BaseCell {
  type: 'folder';
  name: string;
  cells: Cell[];
}

/**
 * Cell containing plain text notes
 */
export interface NoteCell extends BaseCell {
  type: 'note';
  content: string;
}

export interface CodeOutput {
  name: string;
  value: string;
  unit?: string;
}

export interface CodeCell extends BaseCell {
  type: 'code';
  title: string;
  source: string;
  functionName: string;
  outputs: CodeOutput[];
  stdout: string;
  error?: string;
  status: 'idle' | 'stale' | 'running' | 'success' | 'error';
  executionTimeMs?: number;
  context?: Context;
}

/**
 * Union type representing any cell type
 */
export type Cell = EquationCell | FolderCell | NoteCell | CodeCell;

/**
 * Serializable representation of a cell (dates as ISO strings)
 */
export interface SerializableCell {
  id: string;
  type: 'equation' | 'folder' | 'note' | 'code';
  createdAt: string;
  updatedAt: string;
  latex?: string;
  name?: string;
  cells?: SerializableCell[];
  content?: string;
  context?: any;
  solutions?: string[];
  dropdowns?: Dropdown[];
  dropdownSelections?: DropdownSelection[];
  title?: string;
  source?: string;
  functionName?: string;
  outputs?: CodeOutput[];
  stdout?: string;
  error?: string;
  status?: CodeCell['status'];
  executionTimeMs?: number;
}

/**
 * Utility functions for cell serialization
 */
export class CellSerializer {
  /**
   * Convert a Cell to a serializable format
   */
  static serialize(cell: Cell): SerializableCell {
    const base: SerializableCell = {
      id: cell.id,
      type: cell.type,
      createdAt: cell.createdAt.toISOString(),
      updatedAt: cell.updatedAt.toISOString(),
    };

    switch (cell.type) {
      case 'equation':
        return {
          ...base,
          latex: cell.latex,
          context: cell.context ? serializeContext(cell.context) : undefined,
          solutions: cell.solutions,
          dropdowns: cell.dropdowns,
          dropdownSelections: cell.dropdownSelections
        };
      case 'folder':
        return {
          ...base,
          name: cell.name,
          cells: cell.cells.map((c) => CellSerializer.serialize(c)),
        };
      case 'note':
        return { ...base, content: cell.content };
      case 'code':
        return {
          ...base,
          title: cell.title,
          source: cell.source,
          functionName: cell.functionName,
          outputs: cell.outputs,
          stdout: cell.stdout,
          error: cell.error,
          status: cell.status,
          executionTimeMs: cell.executionTimeMs,
          context: cell.context ? serializeContext(cell.context) : undefined
        };
    }
  }

  /**
   * Convert a serializable cell back to a Cell object
   */
  static deserialize(data: SerializableCell): Cell {
    const base = {
      id: data.id,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };

    switch (data.type) {
      case 'equation':
        return {
          ...base,
          type: 'equation',
          latex: data.latex || '',
          context: data.context ? deserializeContext(data.context) : undefined,
          solutions: data.solutions,
          dropdowns: data.dropdowns,
          dropdownSelections: data.dropdownSelections
        };
      case 'folder':
        return {
          ...base,
          type: 'folder',
          name: data.name || '',
          cells: (data.cells || []).map((c) => CellSerializer.deserialize(c)),
        };
      case 'note':
        return {
          ...base,
          type: 'note',
          content: data.content || '',
        };
      case 'code':
        return {
          ...base,
          type: 'code',
          title: data.title || 'Python function',
          source: data.source || 'def calculate():\n    return {}',
          functionName: data.functionName || 'calculate',
          outputs: data.outputs || [],
          stdout: data.stdout || '',
          error: data.error,
          status: data.status || 'idle',
          executionTimeMs: data.executionTimeMs,
          context: data.context ? deserializeContext(data.context) : undefined
        };
      default:
        throw new Error(`Unknown cell type: ${data.type}`);
    }
  }

  /**
   * Create a new equation cell
   */
  static createEquationCell(latex: string = ''): EquationCell {
    return {
      id: crypto.randomUUID(),
      type: 'equation',
      latex,
      context: createContext(),
      solutions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Create a new folder cell
   */
  static createFolderCell(name: string = 'New Folder', cells: Cell[] = []): FolderCell {
    return {
      id: crypto.randomUUID(),
      type: 'folder',
      name,
      cells,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Create a new note cell
   */
  static createNoteCell(content: string = ''): NoteCell {
    return {
      id: crypto.randomUUID(),
      type: 'note',
      content,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  static createCodeCell(source: string = 'def calculate():\n    return {}'): CodeCell {
    return {
      id: crypto.randomUUID(),
      type: 'code',
      title: 'Python function',
      source,
      functionName: 'calculate',
      outputs: [],
      stdout: '',
      status: 'stale',
      context: createContext(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}
