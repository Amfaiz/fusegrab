import { ChevronDownIcon, Folder, X } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogIconButton,
    DialogTitle,
} from '#/components/ui/dialog'
import { InputField, InputIcon, InputRoot } from '#/components/ui/input'
import {
    Select,
    SelectContent,
    SelectIcon,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'

interface DownloadOptionsModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    downloadDir: string
    onSelectFolder: () => void
    defaultQuality: string
    onDefaultQualityChange: (quality: string) => void
}

export function DownloadOptionsModal({
    open,
    onOpenChange,
    downloadDir,
    onSelectFolder,
    defaultQuality,
    onDefaultQualityChange,
}: DownloadOptionsModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Download Settings</DialogTitle>
                    <DialogClose
                        render={
                            <DialogIconButton aria-label="Close">
                                <X className="h-4 w-4" />
                            </DialogIconButton>
                        }
                    />
                </DialogHeader>

                <DialogDescription>
                    Configure default download location and video quality
                    format.
                </DialogDescription>

                <DialogBody className="flex flex-col gap-4 py-2">
                    {/* Download Folder */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-foreground/90 text-xs font-medium">
                            Download Location
                        </label>
                        <InputRoot
                            className="cursor-pointer"
                            onClick={onSelectFolder}
                        >
                            <InputIcon>
                                <Folder />
                            </InputIcon>
                            <InputField
                                readOnly
                                value={downloadDir}
                                placeholder="Select a folder..."
                                className="cursor-pointer"
                            />
                        </InputRoot>
                    </div>

                    {/* Global Quality / Format Selector */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-foreground/90 text-xs font-medium">
                            Default Video Quality / Format
                        </label>
                        <Select
                            value={defaultQuality || 'Best'}
                            onValueChange={(val) => {
                                if (!val) return
                                onDefaultQualityChange(val)
                            }}
                        >
                            <SelectTrigger className="border-border bg-surface hover:border-border-strong h-9 w-full justify-between px-3 text-xs font-medium">
                                <SelectValue placeholder="Best" />
                                <SelectIcon className="text-muted-foreground shrink-0">
                                    <ChevronDownIcon className="size-3.5" />
                                </SelectIcon>
                            </SelectTrigger>
                            <SelectContent
                                align="start"
                                className="w-full min-w-(--anchor-width)"
                            >
                                <SelectItem value="Best">Best</SelectItem>
                                <SelectItem value="1080p">1080p</SelectItem>
                                <SelectItem value="720p">720p</SelectItem>
                                <SelectItem value="480p">480p</SelectItem>
                                <SelectItem value="360p">360p</SelectItem>
                                <SelectItem value="Audio Only">
                                    Audio Only
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </DialogBody>

                <DialogFooter>
                    <Button
                        variant="primary"
                        block
                        onClick={() => onOpenChange(false)}
                    >
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
