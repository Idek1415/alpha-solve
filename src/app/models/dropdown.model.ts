/**
 * Dropdown UI element that can be provided by meta functions
 */
export interface Dropdown {
  title: string;
  items: string[];
}

/**
 * User's selection from a dropdown
 */
export interface DropdownSelection {
  title: string;
  selectedItem: string;
}

/**
 * Create a dropdown
 */
export function createDropdown(title: string, items: string[]): Dropdown {
  return { title, items };
}

/**
 * Create a dropdown selection with default (first item)
 */
export function createDropdownSelection(dropdown: Dropdown): DropdownSelection {
  return {
    title: dropdown.title,
    selectedItem: dropdown.items[0] || ''
  };
}

