import type { CSSProperties, ReactNode } from "react";

type IconProps = { size?: number; className?: string; style?: CSSProperties };

function Svg({ size = 16, className, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const FilesIcon = (p: IconProps) => (
  <Svg {...p}><path d="M15.5 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5L15.5 2Z" /><path d="M15 2v5h5" /></Svg>
);

export const HistoryIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2" /><path d="M6.2 6.2C3.4 8 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6" /></Svg>
);

export const CollapseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 6h16M4 12h10M4 18h16" /><path d="m15 9-3 3 3 3" /></Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Svg>
);

export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" /><path d="M3 9h18l-2 9a2 2 0 0 1-2 1.7H5.7A2 2 0 0 1 3.7 18L2 9Z" /></Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></Svg>
);

export const FileCodeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="m10 14-2 2 2 2M14 14l2 2-2 2" /></Svg>
);

export const FileTextIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></Svg>
);

export const FileImageIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><circle cx="10" cy="13" r="1.2" /><path d="m9 18 3-3 2 2 2-2 1 1" /></Svg>
);

export const BotIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4" /><circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" /><path d="M9 18h6" /></Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Svg>
);

export const WrenchIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14.5 6.5a4 4 0 0 0 5 5L21 21l-2.5-1-4.8-4.8a4 4 0 0 0-5-5L3 3l1 2.5 4.7 4.7" /><circle cx="6" cy="6" r="1.2" /></Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
);

export const XIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></Svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a3 3 0 0 1 3-3h11a4 4 0 0 1 4 4v8Z" /></Svg>
);

export const TerminalIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></Svg>
);

export const PanelCollapseIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /><path d="m10 10-2 2 2 2" /></Svg>
);

export const PanelExpandIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /><path d="m9 10 2 2-2 2" /></Svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 15 6-6 6 6" /></Svg>
);
