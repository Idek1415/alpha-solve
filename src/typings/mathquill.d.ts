declare module 'mathquill' {
  interface MathQuillStaticConfig {
    spaceBehavesLikeTab?: boolean;
    leftRightIntoCmdGoes?: string;
    restrictMismatchedBrackets?: boolean;
    sumStartsWithNEquals?: boolean;
    supSubsRequireOperand?: boolean;
    charsThatBreakOutOfSupSub?: string;
    autoSubscriptNumerals?: boolean;
    autoCommands?: string;
    autoOperatorNames?: string;
    substituteTextarea?: () => HTMLElement;
    handlers?: {
      edit?: (mathField: MathFieldAPI) => void;
      upOutOf?: (mathField: MathFieldAPI) => void;
      downOutOf?: (mathField: MathFieldAPI) => void;
      moveOutOf?: (dir: number, mathField: MathFieldAPI) => void;
    };
  }

  interface MathFieldAPI {
    latex(): string;
    latex(latexString: string): MathFieldAPI;
    text(): string;
    text(text: string): MathFieldAPI;
    write(latex: string): MathFieldAPI;
    cmd(latex: string): MathFieldAPI;
    select(): MathFieldAPI;
    clearSelection(): MathFieldAPI;
    moveToLeftEnd(): MathFieldAPI;
    moveToRightEnd(): MathFieldAPI;
    keystroke(keys: string): MathFieldAPI;
    typedText(text: string): MathFieldAPI;
    config(config: MathQuillStaticConfig): MathFieldAPI;
    revert(): void;
    reflow(): void;
    el(): HTMLElement;
    blur(): void;
    focus(): void;
  }

  interface MathQuillStatic {
    getInterface(version: number): MathQuillAPI;
  }

  interface MathQuillAPI {
    MathField(element: HTMLElement, config?: MathQuillStaticConfig): MathFieldAPI;
    StaticMath(element: HTMLElement): MathFieldAPI;
    config(config: MathQuillStaticConfig): void;
  }

  const MathQuill: MathQuillStatic;
  export default MathQuill;
}

