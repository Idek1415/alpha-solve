import { Component, Input, ElementRef, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';

declare const MathQuill: any;

@Component({
  selector: 'app-latex-renderer',
  imports: [],
  template: '<span class="latex-rendered"></span>',
  styles: [`
    :host {
      display: flex;
      align-items: center;
    }
    .latex-rendered {
      display: inline-block;
    }
  `]
})
export class LatexRendererComponent implements AfterViewInit, OnChanges {
  @Input() latex: string = '';
  private element: HTMLElement;
  private mqStatic: any;

  constructor(private elementRef: ElementRef) {
    this.element = this.elementRef.nativeElement;
  }

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['latex'] && !changes['latex'].firstChange) {
      this.render();
    }
  }

  private render(): void {
    const span = this.element.querySelector('.latex-rendered');
    if (!span) return;

    try {
      // Clear previous content
      span.innerHTML = '';

      // Check if this looks like an error message or plain text
      const isPlainText = this.isPlainText(this.latex);

      if (isPlainText) {
        // Render as plain text for error messages
        span.textContent = this.latex;
        (span as HTMLElement).style.fontStyle = 'italic';
        (span as HTMLElement).style.color = '#666';
        return;
      }

      // Initialize MathQuill static API if not already done
      if (!this.mqStatic && typeof MathQuill !== 'undefined') {
        const MQ = MathQuill.getInterface(2);
        this.mqStatic = MQ.StaticMath;
      }

      // Render the LaTeX using MathQuill's static math mode
      if (this.mqStatic && this.latex) {
        const staticMath = this.mqStatic(span);
        staticMath.latex(this.latex);
      } else {
        span.textContent = this.latex;
      }
    } catch (error) {
      console.error('Error rendering LaTeX:', error);
      // Fallback to plain text
      span.textContent = this.latex;
    }
  }

  private isPlainText(str: string): boolean {
    // Check if the string looks like an error message or plain text
    const errorPatterns = [
      /^Error/i,
      /^No /i,
      /^Unable/i,
      /^Failed/i,
      /^Invalid/i,
      /not found/i,
      /not an equation/i
    ];

    return errorPatterns.some(pattern => pattern.test(str));
  }
}

