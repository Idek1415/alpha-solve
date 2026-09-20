import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  forwardRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

declare const MathQuill: any;

@Component({
  selector: 'app-mathquill-input',
  imports: [],
  template: `
    <div class="mathquill-container">
      <div #mathquillField class="mathquill-input"></div>
    </div>
  `,
  styleUrl: './mathquill-input.component.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MathQuillInputComponent),
      multi: true,
    },
  ],
})
export class MathQuillInputComponent implements AfterViewInit, OnDestroy, OnChanges, ControlValueAccessor {
  @ViewChild('mathquillField', { static: false }) mathquillField!: ElementRef;
  @Input() latex: string = '';
  @Output() latexChange = new EventEmitter<string>();
  @Output() keydownEvent = new EventEmitter<KeyboardEvent>();
  @Output() navigateUp = new EventEmitter<void>();
  @Output() navigateDown = new EventEmitter<void>();
  @Output() createCellBelow = new EventEmitter<void>();

  private mathField: any;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private initAttempts = 0;
  private maxAttempts = 50;
  private isInitializing = true;

  /**
   * Custom command substitutions: maps command names to their LaTeX templates
   *
   * To add more commands, add entries to this Map:
   * ['commandName', 'LaTeX template']
   *
   */
  private customCommands: Map<string, string> = new Map([
    ['int', '\\int_{ }^{ }\\left(\\right)d']
  ]);

  ngAfterViewInit(): void {
    this.waitForMathQuillAndInitialize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When the latex input changes, update the MathQuill field
    if (changes['latex'] && !changes['latex'].firstChange && this.mathField) {
      const newLatex = changes['latex'].currentValue || '';
      // Only update if the value is different from what's currently in the field
      if (this.mathField.latex() !== newLatex) {
        this.isInitializing = true; // Prevent edit handler from firing
        this.mathField.latex(newLatex);
        setTimeout(() => {
          this.isInitializing = false;
        }, 0);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.mathField) {
      this.mathField.revert();
    }
  }

  /**
   * Add a custom command that expands to a LaTeX template when typed
   * @param commandName - The text command to type (e.g., 'int', 'sum', 'lim')
   * @param latexTemplate - The LaTeX to expand to (e.g., '\\int_{ }^{ }')
   *
   * Example: addCustomCommand('sum', '\\sum_{ }^{ }')
   * Then typing 'sum' will expand to the summation template
   */
  addCustomCommand(commandName: string, latexTemplate: string): void {
    this.customCommands.set(commandName, latexTemplate);
  }

  private waitForMathQuillAndInitialize(): void {
    if (typeof MathQuill !== 'undefined') {
      this.initializeMathQuill();
    } else if (this.initAttempts < this.maxAttempts) {
      this.initAttempts++;
      setTimeout(() => this.waitForMathQuillAndInitialize(), 100);
    } else {
      console.error('MathQuill failed to load after maximum attempts');
    }
  }

  private initializeMathQuill(): void {
    const MQ = MathQuill.getInterface(2);

    // Build autoOperatorNames string including custom commands
    const baseOperators = 'sin cos tan sec csc cot sinh cosh tanh sech csch coth arcsin arccos arctan arcsec arccsc arccot log ln lg exp det dim ker gcd lcm min max sup inf lim limsup liminf arg deg hom Pr';
    const customCommandNames = Array.from(this.customCommands.keys()).join(' ');
    const allOperatorNames = `${baseOperators} ${customCommandNames}`;

    this.mathField = MQ.MathField(this.mathquillField.nativeElement, {
      spaceBehavesLikeTab: true,
      autoCommands: 'pi theta phi sigma alpha beta gamma delta epsilon zeta eta iota kappa lambda mu nu xi omicron rho tau upsilon chi psi omega sqrt sum prod',
      autoOperatorNames: allOperatorNames,
      handlers: {
        edit: () => {
          if (this.isInitializing) {
            return;
          }

          // Check for custom command replacements anywhere in the expression
          let latex = this.mathField.latex();
          let wasReplaced = false;

          for (const [cmdName, template] of this.customCommands) {
            const operatorPattern = `\\operatorname{${cmdName}}`;
            if (latex.includes(operatorPattern)) {
              // Replace the operator with its template
              const newLatex = latex.replace(operatorPattern, template);
              this.mathField.latex(newLatex);
              // Move cursor to the end
              this.mathField.moveToLeftEnd().moveToRightEnd();
              wasReplaced = true;
              break;
            }
          }

          if (wasReplaced) {
            return;
          }

          this.latex = latex;
          this.latexChange.emit(latex);
          this.onChange(latex);
        },
        upOutOf: () => {
          this.navigateUp.emit();
        },
        downOutOf: () => {
          this.navigateDown.emit();
        },
      },
    });

    if (this.latex) {
      this.mathField.latex(this.latex);
    }

    // Add keyboard event listener in CAPTURE phase to run before MathQuill
    this.mathquillField.nativeElement.addEventListener('keydown', (event: KeyboardEvent) => {
      // Handle Enter key - create new cell below
      if (event.key === 'Enter') {
        event.preventDefault();
        this.createCellBelow.emit();
        return;
      }

      // For delete/backspace, check if field is empty BEFORE MathQuill processes it
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const currentLatex = this.mathField.latex();
        const isEmpty = !currentLatex || currentLatex.trim() === '';

        // Only notify parent if field is ALREADY empty (to delete the cell)
        // If field has content, let MathQuill handle it without notifying parent
        if (isEmpty) {
          this.keydownEvent.emit(event);
        }
        return;
      }

      // For other keys, always notify parent
      this.keydownEvent.emit(event);
    }, true); // true = use capture phase

    // Allow changes after initialization is complete
    setTimeout(() => {
      this.isInitializing = false;
    }, 0);
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this.latex = value || '';
    if (this.mathField) {
      this.mathField.latex(this.latex);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    // Handle disabled state if needed
  }

  // Public method to focus the MathQuill field
  focus(): void {
    if (this.mathField) {
      this.mathField.focus();
    }
  }
}

