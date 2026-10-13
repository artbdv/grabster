import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { createAppKit, type AppKit } from '@reown/appkit'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import { solana } from '@reown/appkit/networks'
import type { Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { reactive, watch } from 'vue'
import { theme } from './theme'

export type WalletName = 'Phantom' | 'Solflare' | 'WalletConnect'

export const WALLET_META: Record<WalletName, { label: string; icon: string }> = {
  Phantom: { label: 'Phantom', icon: '/wallets/phantom.svg' },
  Solflare: { label: 'Solflare', icon: '/wallets/solflare.svg' },
  WalletConnect: { label: 'WalletConnect', icon: '/wallets/walletconnect.svg' },
}

const SESSION_KEYS = [
  'wagmi.store',
  'wagmi.recentConnectorId',
  '@appkit/active_caip_network_id',
  '@appkit/connected_connector',
  '@appkit/connected_namespace',
]

function clearWalletStorage() {
  if (typeof localStorage === 'undefined') return
  for (const key of SESSION_KEYS) localStorage.removeItem(key)
  const drop: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (
      key.startsWith('@appkit/') ||
      key.startsWith('wagmi.') ||
      key.startsWith('wc@') ||
      key.startsWith('W3M') ||
      key.toLowerCase().includes('walletconnect')
    ) drop.push(key)
  }
  drop.forEach((key) => localStorage.removeItem(key))
}

const PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || 'f2732343949b615aba167226abac2305'
const PHANTOM_WC_ID = 'a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393'
const SOLFLARE_WC_ID = '1ca0bdd4747578705b1939af023d120677c64fe6ca76add81fda36e350605e79'

interface WalletAdapter {
  publicKey: { toBase58(): string } | null
  connect(): Promise<void>
  disconnect(): Promise<void>
  signTransaction(tx: Transaction): Promise<Transaction>
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>
  signMessage?(message: Uint8Array): Promise<Uint8Array>
  on(event: 'disconnect' | 'connect', fn: () => void): void
  removeAllListeners(event: 'disconnect' | 'connect'): void
}

interface SolanaProvider {
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>
  signMessage?(message: Uint8Array): Promise<Uint8Array | { signature: Uint8Array | string }>
}

function sigBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw
  if (typeof raw === 'string') return bs58.decode(raw)
  if (raw && typeof raw === 'object' && 'signature' in raw) return sigBytes((raw as { signature: unknown }).signature)
  throw new Error('This wallet returned an unexpected login signature.')
}

const adapters: Record<'Phantom' | 'Solflare', WalletAdapter> = {
  Phantom: new PhantomWalletAdapter(),
  Solflare: new SolflareWalletAdapter(),
}

export const wallet = reactive({
  name: '' as WalletName | '',
  publicKey: '' as string,
  connecting: false,
})

type AccountFn = (addr: string) => void
let accountFn: AccountFn | null = null

export function onWalletAccountChange(fn: AccountFn | null) {
  accountFn = fn
}

let appkit: AppKit | null = null

function solanaAddress(raw: string | undefined | null): string {
  if (!raw) return ''
  const parts = raw.split(':')
  return parts[parts.length - 1] || ''
}

const LAST_WALLET = 'grabster.lastWallet'

export function lastWalletName(): WalletName | '' {
  if (typeof localStorage === 'undefined') return ''
  try {
    const raw = localStorage.getItem(LAST_WALLET)
    return raw === 'Phantom' || raw === 'Solflare' || raw === 'WalletConnect' ? raw : ''
  } catch {
    return ''
  }
}

export function forgetLastWallet() {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(LAST_WALLET) } catch { /* ignore */ }
}

function rememberLastWallet(name: WalletName) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(LAST_WALLET, name) } catch { /* ignore */ }
}

function clearWallet() {
  wallet.name = ''
  wallet.publicKey = ''
}

function setWallet(name: WalletName, publicKey: string) {
  wallet.name = name
  wallet.publicKey = publicKey
  rememberLastWallet(name)
}

export function initAppKit() {
  if (appkit || typeof window === 'undefined') return appkit
  clearWalletStorage()
  appkit = createAppKit({
    adapters: [new SolanaAdapter({ wallets: [], registerWalletStandard: false })],
    networks: [solana],
    defaultNetwork: solana,
    projectId: PROJECT_ID,
    metadata: {
      name: 'Grabster',
      description: 'Reclaim SOL from empty Solana token accounts.',
      url: window.location.origin,
      icons: [`${window.location.origin}/apple-touch-icon.png`],
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
    },
    enableWalletGuide: false,
    enableReconnect: false,
    excludeWalletIds: [PHANTOM_WC_ID, SOLFLARE_WC_ID],
    themeMode: theme.value,
    themeVariables: {
      '--w3m-accent': '#6F3FF5',
      '--w3m-color-mix': theme.value === 'dark' ? '#121211' : '#F0EFEB',
      '--w3m-color-mix-strength': 20,
      '--w3m-border-radius-master': '0px',
      '--w3m-z-index': 80,
    },
  })
  // The WalletConnect modal follows the site theme.
  watch(theme, (mode) => {
    appkit?.setThemeMode(mode)
    appkit?.setThemeVariables({ '--w3m-color-mix': mode === 'dark' ? '#121211' : '#F0EFEB' })
  })
  appkit.subscribeAccount((acc) => {
    if (wallet.name !== 'WalletConnect') return
    const addr = solanaAddress(acc.address)
    if (acc.isConnected && addr) setWallet('WalletConnect', addr)
    else clearWallet()
  })
  return appkit
}

function getAppKit() {
  return initAppKit()
}

function syncAdapter(name: 'Phantom' | 'Solflare') {
  setWallet(name, adapters[name].publicKey?.toBase58() ?? '')
}

async function disconnectAdapters() {
  await Promise.allSettled([adapters.Phantom.disconnect(), adapters.Solflare.disconnect()])
}

async function disconnectAppKit() {
  const modal = appkit
  if (!modal) return
  try {
    await modal.disconnect()
  } catch {
    /* already closed */
  }
}

export async function disconnectWallet() {
  await disconnectAdapters()
  await disconnectAppKit()
  clearWallet()
}

export async function connectWallet(name: Exclude<WalletName, 'WalletConnect'>) {
  wallet.connecting = true
  try {
    await disconnectWallet()
    const adapter = adapters[name]
    await adapter.connect()
    syncAdapter(name)
    accountFn?.(wallet.publicKey)
    adapter.removeAllListeners('disconnect')
    adapter.removeAllListeners('connect')
    adapter.on('disconnect', () => {
      if (wallet.name === name) clearWallet()
    })
    adapter.on('connect', () => {
      syncAdapter(name)
      accountFn?.(wallet.publicKey)
    })
  } finally {
    wallet.connecting = false
  }
}

function waitForWalletConnect(modal: AppKit): Promise<string> {
  const already = solanaAddress(modal.getAddress?.('solana') ?? modal.getAddress?.())
  if (already && modal.getIsConnectedState?.()) return Promise.resolve(already)

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      unsubAcc()
      unsubState()
      fn()
    }
    const unsubAcc = modal.subscribeAccount((acc) => {
      const addr = solanaAddress(acc.address)
      if (acc.isConnected && addr) done(() => resolve(addr))
    })
    const unsubState = modal.subscribeState((state) => {
      if (state.open) return
      queueMicrotask(() => {
        const addr = solanaAddress(modal.getAddress?.('solana') ?? modal.getAddress?.())
        if (addr && modal.getIsConnectedState?.()) done(() => resolve(addr))
        else done(() => reject(new Error('cancelled')))
      })
    })
  })
}

export async function connectWalletConnect() {
  wallet.connecting = true
  try {
    await disconnectAdapters()
    await disconnectAppKit()
    clearWalletStorage()
    const modal = getAppKit()
    if (!modal) throw new Error('WalletConnect is not available.')
    await modal.open({ view: 'AllWallets', namespace: 'solana' })
    const addr = await waitForWalletConnect(modal)
    setWallet('WalletConnect', addr)
  } finally {
    wallet.connecting = false
  }
}

export async function signAllWallet(txs: Transaction[]): Promise<Transaction[]> {
  if (wallet.name === 'WalletConnect') {
    const modal = getAppKit()
    const provider = (modal?.getWalletProvider?.() ?? modal?.getProvider?.('solana')) as SolanaProvider | undefined
    if (!provider?.signAllTransactions) throw new Error('Connect a wallet first.')
    return provider.signAllTransactions(txs)
  }
  const adapter = wallet.name === 'Phantom' || wallet.name === 'Solflare' ? adapters[wallet.name] : null
  if (!adapter?.publicKey) throw new Error('Connect a wallet first.')
  /* Solflare's signAll often re-encodes the batch; one-by-one keeps the message intact. */
  if (wallet.name === 'Solflare') {
    const signed: Transaction[] = []
    for (const tx of txs) signed.push(await adapter.signTransaction(tx))
    return signed
  }
  return adapter.signAllTransactions(txs)
}

export async function signMessageWallet(message: Uint8Array): Promise<Uint8Array> {
  if (wallet.name === 'WalletConnect') {
    const modal = getAppKit()
    const provider = (modal?.getWalletProvider?.() ?? modal?.getProvider?.('solana')) as SolanaProvider | undefined
    if (!provider?.signMessage) throw new Error('This wallet cannot sign a login message.')
    return sigBytes(await provider.signMessage(message))
  }
  const adapter = wallet.name === 'Phantom' || wallet.name === 'Solflare' ? adapters[wallet.name] : null
  if (!adapter?.signMessage) throw new Error('Connect a wallet first.')
  return sigBytes(await adapter.signMessage(message))
}
