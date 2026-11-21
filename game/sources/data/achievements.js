export const ACHIEVEMENTS_STORAGE_KEY = 'vn-timeline-achievements'

export const CORE_ERA_IDS = [
    'origens',
    'unicamp',
    'industria',
    'dados',
    'ia',
]

export const ORIGENS_MILESTONE_IDS = [
    'e-1994-09',
    'e-2005-01',
    'e-2011-12',
]

/**
 * 8 local-only achievements. Never lock any milestone, era, or project content.
 */
export const ACHIEVEMENTS = [
    {
        id: 'first_step',
        title: 'Primeiros passos em Origens',
        description: 'Deu os primeiros passos pelo cerrado de Origens.',
    },
    {
        id: 'origens_memories',
        title: 'Memórias de Origens',
        description: 'Visitou todos os 3 marcos de Origens (1994, 2005 e 2011).',
    },
    {
        id: 'cerrado_runner',
        title: 'Corredor do cerrado',
        description: 'Perseguiu a seriema pelos caminhos do cerrado.',
    },
    {
        id: 'line_musician',
        title: 'Músico da Linha',
        description: 'Fez grind deslizando pela Linha vermelha.',
    },
    {
        id: 'cartridge_explorer',
        title: 'Curioso de Cartuchos',
        description: 'Abriu um projeto na Praça de Projetos.',
    },
    {
        id: 'secret_hunter',
        title: 'Caçador de Segredos',
        description: 'Abriu uma câmara secreta escondida no mapa.',
    },
    {
        id: 'all_eras',
        title: 'Viajante do Anel',
        description: 'Visitou todas as eras da linha do tempo.',
    },
    {
        id: 'end_dot',
        title: 'O Ponto Final',
        description: 'Chegou ao cartão de contato pelo Ponto Final.',
    },
]

export const ACHIEVEMENTS_BY_ID = new Map(ACHIEVEMENTS.map((item) => [ item.id, item ]))
