import appLogo from '../../assets/icon.rounded.png'

export function AppBrand() {
    return (
        <div className="flex items-center gap-2">
            <img
                src={appLogo}
                alt="FuseGrab"
                className="h-5 w-5 rounded-xs object-contain shadow-xs"
            />
            <span className="text-foreground text-xs font-semibold tracking-wide">
                FuseGrab
            </span>
        </div>
    )
}
