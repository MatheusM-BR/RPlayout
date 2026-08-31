import type { EditScope } from '@rplayout/protocol'

interface Option {
  scope: EditScope
  title: string
  detail: string
  enabled: boolean
}

interface Props {
  value: EditScope
  onChange: (scope: EditScope) => void
  /** Quantos itens desta grade usam o mesmo arquivo, contando este. */
  siblingCount: number
  hasAsset: boolean
  what: 'corte' | 'nível'
}

/**
 * A mesma pergunta para corte e para nível: até onde vale esta edição. Manter
 * o diálogo idêntico nos dois é o que faz o operador aprender uma vez só.
 */
export function ScopePicker({ value, onChange, siblingCount, hasAsset, what }: Props) {
  const others = Math.max(0, siblingCount - 1)

  const options: Option[] = [
    {
      scope: 'ITEM',
      title: 'Só neste item',
      detail: 'Não encosta em mais nada da grade.',
      enabled: true,
    },
    {
      scope: 'RUNDOWN',
      title: 'Todos deste arquivo, nesta grade',
      detail:
        others > 0
          ? `Também vale para ${others} ${others === 1 ? 'outra ocorrência' : 'outras ocorrências'} aqui.`
          : 'Este arquivo só aparece uma vez nesta grade.',
      enabled: hasAsset && others > 0,
    },
    {
      scope: 'ALL_RUNDOWNS',
      title: 'Todos deste arquivo, em todas as grades',
      detail: 'Atravessa as outras grades que usam o mesmo arquivo.',
      enabled: hasAsset,
    },
    {
      scope: 'ASSET_DEFAULT',
      title: 'Gravar como padrão do acervo',
      detail: `Item novo já nasce com este ${what}. Este item volta a herdar.`,
      enabled: hasAsset,
    },
  ]

  const wide = value === 'ALL_RUNDOWNS' || value === 'ASSET_DEFAULT'

  return (
    <div className="field">
      <label>Aplicar em</label>
      <div className="scopes">
        {options.map((option) => (
          <label
            key={option.scope}
            className={`scope${value === option.scope ? ' on' : ''}${option.enabled ? '' : ' off'}`}
          >
            <input
              type="radio"
              name="scope"
              checked={value === option.scope}
              disabled={!option.enabled}
              onChange={() => option.enabled && onChange(option.scope)}
            />
            <div>
              <div className="t">{option.title}</div>
              <div className="d">{option.detail}</div>
            </div>
          </label>
        ))}
      </div>
      {wide && (
        <div className="note warn">
          Este escopo sai desta grade. Confira antes de aplicar: não há desfazer ainda.
        </div>
      )}
    </div>
  )
}
