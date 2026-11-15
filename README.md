# Field Shift — Backend

Serviço de backend em **Node.js (Express)** com **PostgreSQL** para o projeto **Field Shift** (NASA Space Apps Challenge 2026, Desafio 7).

Disponibiliza uma API REST com suporte a CORS para o frontend (Next.js), integrando dados climáticos em tempo real da **NASA POWER** e um catálogo de culturas para Angola enriquecido com dados da **FAO / FAOSTAT**.

---

## 1. Configuração e Instalação

### Requisitos
* Node.js >= 18 (o projeto utiliza **ES Modules** — `"type": "module"`)
* PostgreSQL 14+

### Instalar PostgreSQL (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

### Criar Base de Dados e Utilizador
```bash
sudo -u postgres createuser --createdb field_shift
sudo -u postgres psql -c "ALTER USER field_shift WITH PASSWORD 'change-me';"
sudo -u postgres createdb --owner=field_shift field_shift
```

### Variáveis de Ambiente
Copie o ficheiro `.env.example` para `.env` e ajuste as credenciais:
```bash
cp .env.example .env
```
Exemplo de `.env`:
```env
DATABASE_URL="postgresql://field_shift:change-me@localhost:5432/field_shift"
PORT=4000
```

### Instalação e Povoamento
```bash
# Instalar dependências
npm install

# Criar as tabelas no PostgreSQL
npm run db:migrate

# Povoar catálogo de culturas e estatísticas FAOSTAT
npm run db:seed

# Iniciar o servidor em modo de desenvolvimento (watch mode)
npm run dev

# Ou em modo de produção
npm start
```

---

## 2. Documentação da API REST

* **Base URL:** `http://localhost:4000` (ou a porta configurada em `PORT`)
* **CORS:** Ativo para qualquer origem (`*`) para ligação ao frontend (ex.: Next.js em `http://localhost:3000`).
* **Content-Type:** `application/json`

---

### `GET /api/culturas`
> **Alias:** `GET /api/crops`

Devolve o catálogo de culturas registadas na base de dados para seleção no formulário de entrada.

#### Resposta (`200 OK`)
```json
{
  "metadata": {
    "region": "Angola",
    "source": "PostgreSQL + FAOSTAT"
  },
  "crops": [
    {
      "id": "milho",
      "nome": "Milho",
      "name_pt": "Milho",
      "scientific_name": "Zea mays",
      "botanical_family": "Poaceae",
      "role_in_rotation": "Cultura Principal / Alto Consumo",
      "nitrogen_impact": "Extrator intenso (esgota azoto do solo)",
      "nitrogen_fixation_kg_ha": 0,
      "climate_requirements": {
        "temp_min_c": 15,
        "temp_optimal_min_c": 24,
        "temp_optimal_max_c": 30,
        "water_need_mm_min": 500,
        "water_need_mm_max": 600,
        "drought_tolerance": "Baixa (crítica na floração)"
      },
      "soil_requirements": {
        "ph_min": 5.5,
        "ph_max": 7.5,
        "preferred_texture": ["Franco", "Franco-argiloso"],
        "erosion_protection": "Média"
      },
      "angola_calendar": {
        "cycle_days": 120,
        "planting_months": [10, 11, 12],
        "harvest_months": [2, 3]
      },
      "good_successors": ["feijao_vulgar", "feijao_macunde", "ginguba", "soja"],
      "faostat_stats": {}
    }
  ]
}
```

---

### `POST /api/analises`
> **Alias:** `POST /api/analyses`

Recebe os dados do terreno e preferências do agricultor, consulta a API da **NASA POWER** para as coordenadas indicadas e calcula as estratégias de rotação de culturas (A = referência, B e C = alternativas).

#### Corpo do Pedido (`Request Body`)
```json
{
  "latitude": -12.78,
  "longitude": 15.74,
  "area_ha": 2.5,
  "poligono": null,
  "cultura_atual": {
    "nome": "milho",
    "data_plantio": "2026-10-20"
  },
  "cultura_habitual": null,
  "rega": false,
  "tipo_solo": "arenoso",
  "objetivo_principal": "saude_solo",
  "objetivo_secundario": null,
  "num_epocas": 2
}
```

* **Opções de `tipo_solo`:** `"arenoso"`, `"franco"`, `"argiloso"`, `"nao_sei"`.
* **Opções de `objetivo_principal` / `objetivo_secundario`:** `"saude_solo"`, `"economizar_agua"`, `"reduzir_erosao"`, `"aumentar_rendimento"`.
* **`cultura_atual`:** Pode ser `null` se não houver cultura plantada, ou `{ "nome": "milho", "data_plantio": "..." }`.

#### Resposta (`201 Created`)
```json
{
  "id": "1794741115749-ff9nn6",
  "estado": "concluida",
  "versao_analise": 1,
  "local": {
    "latitude": -12.78,
    "longitude": 15.74,
    "area_ha": 2.5
  },
  "condicoes": {
    "chuva_mensal": [
      { "mes": "Jan", "historico_mm": 116.4, "atual_mm": 68.8 },
      { "mes": "Fev", "historico_mm": 116.4, "atual_mm": 86.8 }
    ],
    "inicio_epoca": {
      "data_tipica": "15 de Outubro (referência regional)",
      "por_ano": []
    },
    "humidade_solo": {
      "valor": 0.71,
      "normal": 0.45,
      "escala": "0 a 1"
    },
    "campo_nu": [],
    "declive": null
  },
  "estado_epoca": null,
  "estrategias": [
    {
      "id": "A",
      "nome": "Rotação atual (referência)",
      "sequencia": [
        { "epoca": 0, "cultura": "Milho", "em_curso": true },
        { "epoca": 1, "cultura": "Milho", "em_curso": false },
        { "epoca": 2, "cultura": "Milho", "em_curso": false }
      ],
      "pontuacao": 55,
      "pontuacao_por_criterio": {
        "agua": 0.45,
        "solo": 0.55,
        "erosao": 0.55,
        "mercado": 0.65
      },
      "confianca": "media",
      "porque": "Mantém a prática indicada pelo agricultor para servir de base comparativa.",
      "evidencia": "NASA POWER: 105.8 mm de precipitação acumulada nos últimos 30 dias. Ciclo agronómico da cultura: 120 dias. Objetivo: saude solo.",
      "beneficios": "Cultura Principal / Alto Consumo. Potencial de fixação biológica de até 0 kg/ha de azoto no solo.",
      "lacunas": "Tipo de solo indicado pelo agricultor sem análise físico-química de laboratório. Calendário exato a calibrar localmente.",
      "riscos": "Precipitação recente abaixo da necessidade ideal da cultura; pode requerer rega suplementar. Confirmar sementes e pragas locais.",
      "fontes": ["NASA POWER", "FAOSTAT", "Catálogo Field Shift"]
    },
    {
      "id": "B",
      "nome": "Solo vivo e resiliência",
      "sequencia": [
        { "epoca": 1, "cultura": "Batata-doce", "em_curso": false },
        { "epoca": 2, "cultura": "Feijão-macunde (Caupi)", "em_curso": false }
      ],
      "pontuacao": 87,
      "pontuacao_por_criterio": { "agua": 0.45, "solo": 1, "erosao": 0.95, "mercado": 0.65 },
      "confianca": "alta",
      "porque": "Combina Batata-doce com culturas de família botânica distinta e fixadora de azoto para quebrar ciclos de pragas e regenerar a terra.",
      "evidencia": "NASA POWER: 105.8 mm de precipitação acumulada nos últimos 30 dias. Ciclo agronómico da cultura: 130 dias. Objetivo: saude solo.",
      "beneficios": "Cobertura de Solo / Quebra de Pragas. Potencial de fixação biológica de até 0 kg/ha de azoto no solo.",
      "lacunas": "Tipo de solo indicado pelo agricultor sem análise físico-química de laboratório. Calendário exato a calibrar localmente.",
      "riscos": "Precipitação recente abaixo da necessidade ideal da cultura; pode requerer rega suplementar. Confirmar sementes e pragas locais.",
      "fontes": ["NASA POWER", "FAOSTAT", "Catálogo Field Shift"]
    },
    {
      "id": "C",
      "nome": "Poupança de água",
      "sequencia": [
        { "epoca": 1, "cultura": "Feijão-macunde (Caupi)", "em_curso": false },
        { "epoca": 2, "cultura": "Batata-doce", "em_curso": false }
      ],
      "pontuacao": 87,
      "pontuacao_por_criterio": { "agua": 0.45, "solo": 1, "erosao": 0.95, "mercado": 0.65 },
      "confianca": "alta",
      "porque": "Combina Feijão-macunde (Caupi) com culturas de família botânica distinta e fixadora de azoto para quebrar ciclos de pragas e regenerar a terra.",
      "evidencia": "NASA POWER: 105.8 mm de precipitação acumulada nos últimos 30 dias. Ciclo agronómico da cultura: 75 dias. Objetivo: saude solo.",
      "beneficios": "Fixador de Azoto / Resiliência à Seca. Potencial de fixação biológica de até 60 kg/ha de azoto no solo.",
      "lacunas": "Tipo de solo indicado pelo agricultor sem análise físico-química de laboratório. Calendário exato a calibrar localmente.",
      "riscos": "Precipitação recente abaixo da necessidade ideal da cultura; pode requerer rega suplementar. Confirmar sementes e pragas locais.",
      "fontes": ["NASA POWER", "FAOSTAT", "Catálogo Field Shift"]
    }
  ],
  "cuidados": null,
  "premissas": [
    {
      "id": "tipo_solo",
      "nome": "Tipo de solo",
      "valor": "arenoso",
      "tipo": "select",
      "opcoes": ["arenoso", "franco", "argiloso", "nao_sei"],
      "origem": "agricultor",
      "estado": "por_validar",
      "editavel": true
    },
    {
      "id": "rega",
      "nome": "Acesso a rega",
      "valor": false,
      "tipo": "boolean",
      "origem": "agricultor",
      "estado": "por_validar",
      "editavel": true
    },
    {
      "id": "sementes",
      "nome": "Sementes disponíveis",
      "valor": "A confirmar localmente",
      "tipo": "select",
      "opcoes": ["Locais certificadas", "Mercado informal", "A confirmar localmente"],
      "origem": "agricultor",
      "estado": "por_validar",
      "editavel": true
    },
    {
      "id": "calendario",
      "nome": "Início do plantio",
      "valor": "Outubro",
      "tipo": "select",
      "opcoes": ["Setembro", "Outubro", "Novembro", "Dezembro"],
      "origem": "literatura",
      "estado": "por_validar",
      "editavel": true
    }
  ],
  "metadados": {
    "fontes": ["NASA POWER", "FAOSTAT", "Catálogo Field Shift"],
    "resolucoes": "Chuva e humidade do solo: célula de cerca de 50 km. Vegetação: 250 m.",
    "datas_dados": "NASA POWER (últimos 30 dias)",
    "avisos": [
      "Esta ferramenta apoia a decisão do agricultor e não substitui assistência agronómica local.",
      "Não constitui previsão meteorológica."
    ]
  }
}
```

---

### `GET /api/analises/:id`
> **Alias:** `GET /api/analyses/:id`

Consulta os resultados de uma análise criada anteriormente pelo seu identificador único.

#### Resposta (`200 OK`)
Devolve o mesmo objeto JSON descrito em `POST /api/analises`.

#### Resposta de Erro (`404 Not Found`)
```json
{
  "estado": "erro",
  "erro": {
    "codigo": "analise_nao_encontrada",
    "mensagem": "Análise não encontrada."
  }
}
```

---

### `PATCH /api/analises/:id/premissas`
> **Alias:** `PATCH /api/analyses/:id/premises`

Atualiza as premissas indicadas pelo agricultor (ex.: correção do tipo de solo ou acesso a rega) e recalcula as pontuações e estratégias de rotação. Utiliza os dados climáticos em memória (cache), sem fazer novas consultas à NASA.

#### Corpo do Pedido (`Request Body`)
```json
{
  "tipo_solo": "argiloso",
  "rega": true
}
```

#### Resposta (`200 OK`)
Devolve a análise recalculada com:
* `versao_analise` incrementada (ex.: de `1` para `2`);
* As premissas atualizadas com `estado: "validada"`;
* Novas pontuações e ordem de estratégias calculadas com base nas premissas corrigidas.

---

### Endpoints Utilitários Adicionais

#### `GET /api/climate?latitude=-12.78&longitude=15.74`
Devolve diretamente o resumo climático observado da NASA POWER (precipitação acumulada, temperatura média, humidade média e radiação solar) para as coordenadas fornecidas.

#### `GET /api/recommendations?latitude=-12.78&longitude=15.74`
Devolve a lista ordenada de culturas e respetiva pontuação de adequação climática para o ponto indicado.
