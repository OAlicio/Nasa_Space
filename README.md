# Field Shift — Backend

Backend service in **Node.js (Express)** with **PostgreSQL** for the **Field Shift** project (NASA Space Apps Challenge 2026, Challenge 7).

Provides a REST API with CORS support for the frontend, integrating near-real-time climate data from **NASA POWER** and a crop catalog for Angola enriched with data from the **FAO / FAOSTAT**.

> 🌐 **Frontend Repository:**  
> The web application interface (built with Next.js, Leaflet, and Tailwind CSS) is available at:  
> **[https://github.com/jormaedes/field_shift_frontend](https://github.com/jormaedes/field_shift_frontend)**

---

## 1. Setup and Installation

### Requirements
* Node.js >= 18 (the project uses **ES Modules** — `"type": "module"`)
* PostgreSQL 14+ (Local or cloud-hosted with [Neon](https://neon.tech))

### Option A: Cloud PostgreSQL (Neon)
If you are using a managed database on **Neon**:
1. Copy the connection string from your Neon dashboard (with `sslmode=require`).
2. Add it to your `.env` file:
```env
DATABASE_URL="postgresql://neondb_owner:PASSWORD@ep-xyz.neon.tech/neondb?sslmode=require"
PORT=4000
```
3. Run migrations and database seeding:
```bash
npm run db:migrate
npm run db:seed
```

---

### Option B: Local PostgreSQL (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Create the local database and user:
```bash
sudo -u postgres createuser --createdb field_shift
sudo -u postgres psql -c "ALTER USER field_shift WITH PASSWORD 'change-me';"
sudo -u postgres createdb --owner=field_shift field_shift
```

Copy the `.env.example` file to `.env` and configure:
```bash
cp .env.example .env
```
Example `.env`:
```env
DATABASE_URL="postgresql://field_shift:change-me@localhost:5432/field_shift"
PORT=4000
```

---

### Available Scripts

```bash
# Install dependencies
npm install

# Run database migrations (local or Neon)
npm run db:migrate

# Seed crop catalog and FAOSTAT statistics
npm run db:seed

# Start development server (watch mode)
npm run dev

# Or start in production mode
npm start
```

---

## 2. REST API Documentation

* **Base URL:** `http://localhost:4000` (or configured `PORT`)
* **CORS:** Enabled for any origin (`*`) to connect with frontend applications (e.g. Next.js on `http://localhost:3000`).
* **Content-Type:** `application/json`

---

### `GET /api/culturas`
> **Alias:** `GET /api/crops`

Returns the crop catalog registered in the database for selection in the form.

#### Response (`200 OK`)
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

Receives plot information and farmer preferences, queries the **NASA POWER** API for the specified coordinates, and calculates crop rotation strategies (A = reference, B & C = alternatives).

#### Request Body
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

* **`tipo_solo` options:** `"arenoso"` (sandy), `"franco"` (loam), `"argiloso"` (clay), `"nao_sei"` (unknown).
* **`objetivo_principal` / `objetivo_secundario` options:** `"saude_solo"` (soil health), `"economizar_agua"` (water conservation), `"reduzir_erosao"` (erosion reduction), `"aumentar_rendimento"` (yield increase).
* **`cultura_atual`:** Can be `null` when no crop is currently planted, or `{ "nome": "milho", "data_plantio": "..." }`.

#### Response (`201 Created`)
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

Retrieves the results of a previously created analysis by its unique ID.

#### Response (`200 OK`)
Returns the same JSON object described in `POST /api/analises`.

#### Error Response (`404 Not Found`)
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

Updates premises specified by the farmer (e.g. correcting soil type or irrigation access) and recalculates rotation scores and strategies. Uses in-memory cached climate data without performing new requests to NASA.

#### Request Body
```json
{
  "tipo_solo": "argiloso",
  "rega": true
}
```

#### Response (`200 OK`)
Returns the recalculated analysis with:
* Incremented `versao_analise` (e.g., from `1` to `2`);
* Updated premises with `estado: "validada"`;
* Recalculated scores and strategy ranking based on the adjusted premises.

---

### Additional Utility Endpoints

#### `GET /api/climate?latitude=-12.78&longitude=15.74`
Returns the direct observed climate summary from NASA POWER (accumulated precipitation, average temperature, relative humidity, and solar radiation) for the provided coordinates.

#### `GET /api/recommendations?latitude=-12.78&longitude=15.74`
Returns the ranked list of crops and their climate suitability score for the specified coordinates.

---

## 3. Related Repositories

* **Frontend:** [https://github.com/jormaedes/field_shift_frontend](https://github.com/jormaedes/field_shift_frontend)
