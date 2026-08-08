import { Loader2, Search, X } from '#/components/icons'
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

interface AddUrlModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    inputUrl: string
    setInputUrl: (val: string) => void
    loadingInfo: boolean
    error: string | null
    onSubmit: () => void
}

export function AddUrlModal({
    open,
    onOpenChange,
    inputUrl,
    setInputUrl,
    loadingInfo,
    error,
    onSubmit,
}: AddUrlModalProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (loadingInfo) return
                onOpenChange(nextOpen)
            }}
        >
            <DialogContent>
                <form
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (!loadingInfo && inputUrl.trim()) {
                            onSubmit()
                        }
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>Add URL</DialogTitle>
                        <DialogClose
                            disabled={loadingInfo}
                            render={
                                <DialogIconButton
                                    aria-label="Close"
                                    disabled={loadingInfo}
                                    className="disabled:pointer-events-none disabled:opacity-40"
                                >
                                    <X className="size-3.5" />
                                </DialogIconButton>
                            }
                        />
                    </DialogHeader>

                    <DialogDescription>
                        Enter a YouTube video, playlist, or channel URL to download.
                    </DialogDescription>

                    <DialogBody>
                        <InputRoot>
                            <InputIcon>
                                <Search />
                            </InputIcon>
                            <InputField
                                autoFocus
                                placeholder="Add URL..."
                                value={inputUrl}
                                onChange={(e) => setInputUrl(e.target.value)}
                                disabled={loadingInfo}
                            />
                        </InputRoot>
                        {error && (
                            <p className="text-danger text-xs">{error}</p>
                        )}
                    </DialogBody>

                    <DialogFooter>
                        <Button
                            type="submit"
                            variant="primary"
                            block
                            disabled={loadingInfo || !inputUrl.trim()}
                        >
                            {loadingInfo && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            Continue
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
