# Field Shift

Dashboard de apoio à decisão agrícola para Angola, com clima da NASA POWER e catálogo de culturas enriquecido com dados FAOSTAT.

## PostgreSQL

O catálogo de culturas agora é servido por PostgreSQL. O arquivo `plants.json` é usado somente pelo seed inicial para preservar os requisitos agronómicos que não existem na FAOSTAT.

### Instalar PostgreSQL no Linux

Em distribuições baseadas em Debian/Ubuntu:

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Crie a base e um utilizador local:

```bash
sudo -u postgres createuser --createdb field_shift
sudo -u postgres createdb --owner=field_shift field_shift
export DATABASE_URL=postgresql://field_shift@localhost:5432/field_shift
```

Instale as dependências e carregue o catálogo:

```bash
npm install
npm run db:migrate
npm run db:seed
npm start
```

O seed consulta o domínio FAOSTAT `QCL` (Crops and livestock products), filtrando Angola e associando estatísticas de produção, rendimento e área colhida às culturas locais. O endpoint pode ser substituído com `FAOSTAT_API_URL` caso a FAO altere o serviço.