import type { HugeiconsIconProps } from '@hugeicons/react'

import {
    Add01Icon,
    ArrowDown01Icon,
    Cancel01Icon,
    Delete02Icon,
    Download04Icon,
    Folder01Icon,
    Folder03Icon,
    Globe02Icon,
    LinkSquare02Icon,
    Loading03Icon,
    Logout01Icon,
    MoreHorizontalSquareIcon,
    PauseIcon,
    PlayIcon,
    RefreshIcon,
    Remove01Icon,
    Search01Icon,
    Settings01Icon,
    Tick02Icon,
    Video02Icon,
    WhatsappIcon,
    YoutubeIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

export type IconProps = Omit<HugeiconsIconProps, 'icon'>
export type IconComponent = (props: IconProps) => React.ReactElement

function makeIcon(icon: HugeiconsIconProps['icon']): IconComponent {
    const Component = (props: IconProps) => (
        <HugeiconsIcon icon={icon} {...props} />
    )
    return Component
}

export const Plus = makeIcon(Add01Icon)
export const Check = makeIcon(Tick02Icon)
export const ChevronDownIcon = makeIcon(ArrowDown01Icon)
export const Download = makeIcon(Download04Icon)
export const ExternalLink = makeIcon(LinkSquare02Icon)
export const Video = makeIcon(Video02Icon)
export const Whatsapp = makeIcon(WhatsappIcon)
export const Folder = makeIcon(Folder01Icon)
export const FolderOpen = makeIcon(Folder03Icon)
export const Globe = makeIcon(Globe02Icon)
export const Youtube = makeIcon(YoutubeIcon)
export const Loader2 = makeIcon(Loading03Icon)
export const Logout = makeIcon(Logout01Icon)
export const Minus = makeIcon(Remove01Icon)
export const MoreHorizontal = makeIcon(MoreHorizontalSquareIcon)
export const Pause = makeIcon(PauseIcon)
export const Play = makeIcon(PlayIcon)
export const RefreshCw = makeIcon(RefreshIcon)
export const Search = makeIcon(Search01Icon)
export const Settings = makeIcon(Settings01Icon)
export const Trash2 = makeIcon(Delete02Icon)
export const X = makeIcon(Cancel01Icon)
