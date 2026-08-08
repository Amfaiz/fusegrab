import type { DownloadItem } from './types'

import { RefreshCw, X } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogIconButton,
    DialogTitle,
} from '#/components/ui/dialog'

interface FileMissingDialogProps {
    item: DownloadItem | null
    onClose: () => void
    onRedownload: (itemId: string) => void
}

export function FileMissingDialog({
    item,
    onClose,
    onRedownload,
}: FileMissingDialogProps) {
    if (!item) return null

    return (
        <Dialog
            open={Boolean(item)}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>File Not Found</DialogTitle>
                    <DialogClose
                        render={
                            <DialogIconButton aria-label="Close">
                                <X className="size-3.5" />
                            </DialogIconButton>
                        }
                    />
                </DialogHeader>

                <DialogBody>
                    <p className="text-foreground text-xs">
                        The file or directory may have been removed, renamed, or
                        deleted. Do you want to download it again?
                    </p>
                </DialogBody>

                <DialogFooter className="flex flex-row items-center justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => {
                            const id = item.id
                            onClose()
                            onRedownload(id)
                        }}
                    >
                        <RefreshCw className="size-3.5" />
                        <span>Redownload</span>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
