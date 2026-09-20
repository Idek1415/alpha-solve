import { Component, Input, Output, EventEmitter, ViewChildren, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Cell, EquationCell, NoteCell, FolderCell, CellSerializer } from '../../models';
import { MathQuillInputComponent } from '../mathquill-input/mathquill-input.component';
import { LatexRendererComponent } from '../latex-renderer/latex-renderer.component';

@Component({
  selector: 'app-cell-list',
  imports: [CommonModule, FormsModule, MathQuillInputComponent, LatexRendererComponent],
  templateUrl: './cell-list.component.html',
  styleUrl: './cell-list.component.css',
})
export class CellListComponent {
  @Input() cells: Cell[] = [];
  @Output() cellSelected = new EventEmitter<Cell>();
  @Output() cellUpdated = new EventEmitter<string>();
  @Output() cellCreated = new EventEmitter<{ cell: Cell; index: number; parentArray: Cell[] }>();
  @Output() cellDeleted = new EventEmitter<{ cellId: string; parentArray: Cell[] }>();
  @Output() cellMoved = new EventEmitter<{ cellId: string; fromIndex: number; toIndex: number; parentArray: Cell[] }>();
  @ViewChildren(MathQuillInputComponent) mathquillInputs!: QueryList<MathQuillInputComponent>;

  expandedFolders = new Set<string>();
  draggedCell: Cell | null = null;
  draggedFromParent: Cell[] | null = null;
  dropTargetId: string | null = null;
  dropAtEndTarget: string | null = null;

  // Debug mode
  isDebugMode = false;
  hoveredCellId: string | null = null;

  constructor() {
    // Check for debug mode in URL
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      this.isDebugMode = urlParams.get('debug') === 'true';
    }
  }

  onLatexChange(cell: EquationCell, newLatex: string, parentArray: Cell[]): void {
    // Check for cell type conversion keywords
    if (newLatex.toLowerCase() === 'folder') {
      this.convertToFolder(cell, parentArray);
      return;
    } else if (newLatex.toLowerCase() === 'note') {
      this.convertToNote(cell, parentArray);
      return;
    }

    cell.latex = newLatex;
    cell.updatedAt = new Date();

    // Emit cell updated event
    this.cellUpdated.emit(cell.id);
  }

  onNoteChange(cell: NoteCell, newContent: string): void {
    cell.content = newContent;
    cell.updatedAt = new Date();

    // Emit cell updated event
    this.cellUpdated.emit(cell.id);
  }

  onDropdownChange(cell: EquationCell): void {
    // When dropdown selection changes, update the cell and trigger recalculation
    cell.updatedAt = new Date();
    this.cellUpdated.emit(cell.id);
  }

  onFolderNameChange(cell: FolderCell, newName: string): void {
    cell.name = newName;
    cell.updatedAt = new Date();

    // Emit cell updated event
    this.cellUpdated.emit(cell.id);
  }

  toggleFolder(folderId: string): void {
    if (this.expandedFolders.has(folderId)) {
      this.expandedFolders.delete(folderId);
    } else {
      this.expandedFolders.add(folderId);
    }
  }

  isFolderExpanded(folderId: string): boolean {
    return this.expandedFolders.has(folderId);
  }

  asEquationCell(cell: Cell): EquationCell {
    return cell as EquationCell;
  }

  asNoteCell(cell: Cell): NoteCell {
    return cell as NoteCell;
  }

  asFolderCell(cell: Cell): FolderCell {
    return cell as FolderCell;
  }

  onDragStart(event: DragEvent, cell: Cell, parentArray: Cell[]): void {
    this.draggedCell = cell;
    this.draggedFromParent = parentArray;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', cell.id);
    }
  }

  onDragOver(event: DragEvent, targetCell?: Cell): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (targetCell) {
      this.dropTargetId = targetCell.id;
    }
  }

  onDragOverEnd(event: DragEvent, endZoneId: string): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dropAtEndTarget = endZoneId;
  }

  onDragLeave(event: DragEvent): void {
    this.dropTargetId = null;
  }

  onDragLeaveEnd(event: DragEvent): void {
    this.dropAtEndTarget = null;
  }

  onDrop(event: DragEvent, targetCell: Cell, targetParentArray: Cell[]): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.draggedCell || !this.draggedFromParent) return;

    // Check if moving within the same parent
    const sameParent = this.draggedFromParent === targetParentArray;

    // Store info for the move event
    const cellId = this.draggedCell.id;
    const fromIndex = this.draggedFromParent.indexOf(this.draggedCell);

    // Remove from original position
    if (fromIndex > -1) {
      this.draggedFromParent.splice(fromIndex, 1);
    }

    // Insert at new position
    const targetIndex = targetParentArray.indexOf(targetCell);
    targetParentArray.splice(targetIndex, 0, this.draggedCell);

    // Emit cell moved event (only if moved within same parent)
    if (sameParent && fromIndex !== -1 && targetIndex !== -1) {
      this.cellMoved.emit({ cellId, fromIndex, toIndex: targetIndex, parentArray: targetParentArray });
    }

    // Emit update from the earliest affected cell (for equation cells only)
    if (sameParent && this.draggedCell.type === 'equation') {
      // Find the earliest position that was affected
      const earliestIndex = Math.min(fromIndex, targetIndex);
      if (earliestIndex >= 0 && earliestIndex < targetParentArray.length) {
        this.cellUpdated.emit(targetParentArray[earliestIndex].id);
      }
    } else if (!sameParent && this.draggedCell.type === 'equation') {
      // Moved to different parent, update from insertion point in target
      if (targetIndex >= 0 && targetIndex < targetParentArray.length) {
        this.cellUpdated.emit(targetParentArray[targetIndex].id);
      }
    }

    this.draggedCell = null;
    this.draggedFromParent = null;
    this.dropTargetId = null;
  }

  onDragEnd(): void {
    this.draggedCell = null;
    this.draggedFromParent = null;
    this.dropTargetId = null;
    this.dropAtEndTarget = null;
  }

  onDropAtEnd(event: DragEvent, targetParentArray: Cell[]): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.draggedCell || !this.draggedFromParent) return;

    // Check if moving within the same parent
    const sameParent = this.draggedFromParent === targetParentArray;

    // Store info for the move event
    const cellId = this.draggedCell.id;
    const fromIndex = this.draggedFromParent.indexOf(this.draggedCell);

    // Remove from original position
    if (fromIndex > -1) {
      this.draggedFromParent.splice(fromIndex, 1);
    }

    // Add to end of list
    const toIndex = targetParentArray.length;
    targetParentArray.push(this.draggedCell);

    // Emit cell moved event (only if moved within same parent)
    if (sameParent && fromIndex !== -1) {
      this.cellMoved.emit({ cellId, fromIndex, toIndex, parentArray: targetParentArray });
    }

    // Emit update from the earliest affected cell (for equation cells only)
    if (sameParent && this.draggedCell.type === 'equation') {
      // Update from the old position since we removed from there
      if (fromIndex >= 0 && fromIndex < targetParentArray.length) {
        this.cellUpdated.emit(targetParentArray[fromIndex].id);
      }
    } else if (!sameParent && this.draggedCell.type === 'equation' && targetParentArray.length > 0) {
      // Moved to different parent, update the dragged cell (now at the end)
      this.cellUpdated.emit(this.draggedCell.id);
    }

    this.draggedCell = null;
    this.draggedFromParent = null;
    this.dropTargetId = null;
    this.dropAtEndTarget = null;
  }

  getEndZoneId(prefix: string): string {
    return `${prefix}-end`;
  }

  addNewCell(parentArray: Cell[]): void {
    const newCell = CellSerializer.createEquationCell('');
    const index = parentArray.length;
    parentArray.push(newCell);

    // Emit cell created event
    this.cellCreated.emit({ cell: newCell, index, parentArray });

    // Focus the new cell after it's been added to the DOM
    setTimeout(() => {
      this.focusCell(newCell);
    }, 0);
  }

  onCellKeyDown(event: KeyboardEvent, cell: Cell, parentArray: Cell[]): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onCreateCellBelow(cell, parentArray);
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.isCellEmpty(cell)) {
        event.preventDefault();
        this.deleteCell(cell, parentArray);
      }
    }
  }

  isCellEmpty(cell: Cell): boolean {
    switch (cell.type) {
      case 'equation':
        return !cell.latex || cell.latex.trim() === '';
      case 'note':
        return !cell.content || cell.content.trim() === '';
      case 'folder':
        return !cell.name || cell.name.trim() === '';
      default:
        return false;
    }
  }

  deleteCell(cell: Cell, parentArray: Cell[]): void {
    const index = parentArray.indexOf(cell);
    if (index === -1) return;

    // Emit cell deleted event
    this.cellDeleted.emit({ cellId: cell.id, parentArray });

    // Find the cell to focus after deletion (the one before this one)
    let cellToFocus: Cell | null = null;
    if (index > 0) {
      cellToFocus = parentArray[index - 1];
    }

    // If it's a folder, move its children up
    if (cell.type === 'folder') {
      const folderCell = cell as FolderCell;
      // Remove the folder
      parentArray.splice(index, 1);
      // Insert all children at the same position
      parentArray.splice(index, 0, ...folderCell.cells);
    } else {
      // Just remove the cell
      parentArray.splice(index, 1);
    }

    // Focus the previous cell if it exists
    if (cellToFocus) {
      setTimeout(() => {
        this.focusCell(cellToFocus!);
      }, 0);
    }
  }

  convertToFolder(cell: Cell, parentArray: Cell[]): void {
    const index = parentArray.indexOf(cell);
    if (index === -1) return;

    const folderCell = CellSerializer.createFolderCell('');
    folderCell.id = cell.id; // Keep the same ID
    folderCell.createdAt = cell.createdAt;
    folderCell.updatedAt = new Date();

    parentArray.splice(index, 1, folderCell);

    // Auto-expand the newly created folder
    this.expandedFolders.add(folderCell.id);
  }

  convertToNote(cell: Cell, parentArray: Cell[]): void {
    const index = parentArray.indexOf(cell);
    if (index === -1) return;

    const noteCell = CellSerializer.createNoteCell('');
    noteCell.id = cell.id; // Keep the same ID
    noteCell.createdAt = cell.createdAt;
    noteCell.updatedAt = new Date();

    parentArray.splice(index, 1, noteCell);
  }

  onSolutionMouseEnter(cellId: string): void {
    if (this.isDebugMode) {
      this.hoveredCellId = cellId;
    }
  }

  onSolutionMouseLeave(): void {
    this.hoveredCellId = null;
  }

  formatContext(cell: EquationCell): string {
    if (!cell.context || !cell.context.variables || cell.context.variables.length === 0) {
      return 'No variables in context';
    }

    return cell.context.variables
      .map(v => `${v.name} (${v.type}): [${v.values.join(', ')}]`)
      .join('\n');
  }

  async onSolutionClick(solution: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(solution);
    } catch (error) {
      console.error('Failed to copy solution to clipboard:', error);
    }
  }

  onNavigateUp(cell: Cell, parentArray: Cell[]): void {
    const index = parentArray.indexOf(cell);
    if (index > 0) {
      const previousCell = parentArray[index - 1];
      this.focusCell(previousCell);
    }
  }

  onNavigateDown(cell: Cell, parentArray: Cell[]): void {
    const index = parentArray.indexOf(cell);
    if (index < parentArray.length - 1) {
      const nextCell = parentArray[index + 1];
      this.focusCell(nextCell);
    }
  }

  onCreateCellBelow(cell: Cell, parentArray: Cell[]): void {
    const index = parentArray.indexOf(cell);
    const newCell = CellSerializer.createEquationCell('');
    const newIndex = index + 1;
    parentArray.splice(newIndex, 0, newCell);

    // Emit cell created event
    this.cellCreated.emit({ cell: newCell, index: newIndex, parentArray });

    // Focus the new cell after it's been added to the DOM
    setTimeout(() => {
      this.focusCell(newCell);
    }, 0);
  }

  public focusCell(cell: Cell): void {
    setTimeout(() => {
      const cellElement = document.querySelector(`[data-cell-id="${cell.id}"]`);
      if (cellElement) {
        if (cell.type === 'equation') {
          const cellIndex = this.findCellIndexInAllCells(cell);
          const mathquillInputsArray = this.mathquillInputs.toArray();

          if (cellIndex >= 0 && cellIndex < mathquillInputsArray.length) {
            mathquillInputsArray[cellIndex].focus();
          }
        } else {
          const inputElement = cellElement.querySelector('.note-input, .folder-input') as HTMLInputElement;
          if (inputElement) {
            inputElement.focus();
          }
        }
      }
    }, 0);
  }

  private findCellIndexInAllCells(targetCell: Cell): number {
    const equationCells: Cell[] = [];

    const collectEquationCells = (cells: Cell[]) => {
      for (const cell of cells) {
        if (cell.type === 'equation') {
          equationCells.push(cell);
        }
        if (cell.type === 'folder') {
          collectEquationCells((cell as FolderCell).cells);
        }
      }
    };

    collectEquationCells(this.cells);
    return equationCells.findIndex(cell => cell.id === targetCell.id);
  }
}
