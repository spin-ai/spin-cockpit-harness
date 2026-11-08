declare module "turndown" {
  export type Options = {
    headingStyle?: "setext" | "atx";
    hr?: string;
    bulletListMarker?: "-" | "+" | "*";
    codeBlockStyle?: "indented" | "fenced";
    fence?: "```" | "~~~";
    emDelimiter?: "_" | "*";
    strongDelimiter?: "__" | "**";
    linkStyle?: "inlined" | "referenced";
    linkReferenceStyle?: "full" | "collapsed" | "shortcut";
    br?: string;
    keep?: (node: HTMLElement) => boolean;
  };
  export default class TurndownService {
    constructor(options?: Options);
    use(plugin: unknown): TurndownService;
    addRule(key: string, rule: unknown): TurndownService;
    keep(filter: string | string[] | ((node: HTMLElement) => boolean)): TurndownService;
    remove(filter: string | string[] | ((node: HTMLElement) => boolean)): TurndownService;
    turndown(input: string | HTMLElement): string;
  }
}

declare module "turndown-plugin-gfm" {
  export const gfm: unknown;
  export const tables: unknown;
  export const strikethrough: unknown;
  export const taskListItems: unknown;
  export const highlightedCodeBlock: unknown;
}
