/** Parse existing configuration once, before discovery starts. Never substitute
 * an existing live address with the first source returned by the network. */
export function initialProtocolConfig(uri: string) {
  const name = uri.replace(/^(ndi|omt|sdi):(?:\/\/)?/i, '')
  let url: URL | null = null
  try { url = new URL(uri) } catch { /* Source names are not URLs. */ }
  const numeric = (key: string, fallback: number) => {
    const value = Number(url?.searchParams.get(key))
    return value > 0 ? value : fallback
  }
  const srtMode = url?.searchParams.get('mode')
  const mode: 'caller' | 'listener' | 'rendezvous' | null = srtMode === 'caller' || srtMode === 'listener' || srtMode === 'rendezvous' ? srtMode : null
  return {
    name,
    host: url?.hostname || '127.0.0.1',
    port: Number(url?.port) || 9000,
    srtMode: mode,
    latency: numeric('latency', 800),
    passphrase: url?.searchParams.get('passphrase') || '',
    streamId: url?.searchParams.get('streamid') || '',
  }
}

export function sourceName(reference: string, sources: readonly { reference: string; label: string }[]) {
  // Selector canonicalizes ndi:// and omt:// to ndi:/omt:. Match labels
  // across those spellings, without folding the actual source name's case
  // or accents and without conflating identical names on different protocols.
  const identity=(value:string)=>value.replace(/^(ndi|omt|sdi):(?:\/\/)?/i,(_match,kind:string)=>`${kind.toLowerCase()}:`)
  return (sources.find((source) => source.reference === reference)
    ??sources.find((source)=>identity(source.reference)===identity(reference)))?.label
    || reference.replace(/^(ndi|omt|sdi):(?:\/\/)?/i, '')
}

/** A manual alias belongs to the operator; otherwise follow every selection. */
export function inputName(current: string, recommendation: string | undefined, manuallyEdited: boolean) {
  return manuallyEdited ? current : recommendation || ''
}
