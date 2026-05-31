export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve?: (v: boolean) => void
}

export function useConfirm() {
  const state = useState<ConfirmState>('confirm-dialog', () => ({
    open: false,
    title: '',
  }))

  function ask(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      state.value = { open: true, ...opts, resolve }
    })
  }

  function close(result: boolean) {
    state.value.resolve?.(result)
    state.value = { open: false, title: '' }
  }

  return { state, ask, close }
}
