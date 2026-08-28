import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPrev(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon points="19 5 9 12 19 19 19 5" fill="currentColor" stroke="none" />
      <line x1="6" y1="5" x2="6" y2="19" />
    </Svg>
  );
}

export function IconNext(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon points="5 5 15 12 5 19 5 5" fill="currentColor" stroke="none" />
      <line x1="18" y1="5" x2="18" y2="19" />
    </Svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 7 L6 12 L11 17" />
      <path d="M6 12 H18" />
    </Svg>
  );
}

export function IconFwd(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 7 L18 12 L13 17" />
      <path d="M6 12 H18" />
    </Svg>
  );
}

export function IconRepeatOne(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <path d="M12 9.5v5" />
      <path d="M12 9.5c.8 0 1.4.4 1.4 1.2 0 .9-.8 1.2-1.4 1.2" />
    </Svg>
  );
}

export function IconRepeatAll(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  );
}

export function IconArtistLoop(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6.5 19c.6-2.6 2.7-4 5.5-4s4.9 1.4 5.5 4" />
      <path d="M19 3v4" />
      <path d="M17 5h4" />
    </Svg>
  );
}

export function IconShuffle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 3h5v5" />
      <path d="M4 20 L19 5" />
      <path d="M21 16v5h-5" />
      <path d="M15 15 L21 21" />
      <path d="M4 4 L9 9" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16 L20.5 20.5" />
    </Svg>
  );
}

export function IconVolume(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10h3l5-4v12l-5-4H4z" fill="currentColor" stroke="none" />
      <path d="M16 9.5c1.2 1 1.8 2.2 1.8 2.5s-.6 1.5-1.8 2.5" />
      <path d="M18.7 7.5c1.8 1.6 2.6 3.5 2.6 4.5s-.8 2.9-2.6 4.5" />
    </Svg>
  );
}

export function IconMute(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10h3l5-4v12l-5-4H4z" fill="currentColor" stroke="none" />
      <path d="M16 10 L21 15" />
      <path d="M21 10 L16 15" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 L13.6 9.2 L20 10 L13.6 10.8 L12 17 L10.4 10.8 L4 10 L10.4 9.2 Z" />
      <path d="M18 14 L18.8 16.6 L21.5 17.2 L18.8 17.8 L18 20.5 L17.2 17.8 L14.5 17.2 L17.2 16.6 Z" />
    </Svg>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.6-7 10-7 10z" />
    </Svg>
  );
}

export function IconHeartFill(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.6-7 10-7 10z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}
