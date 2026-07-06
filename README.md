# MoneyMachine

Bot de trading para Binance desplegable en Vercel. Soporta 3 modos de trading: **Binary Options**, **Spot** y **Futures**, con la misma estrategia de indicadores técnicos (EMA3/8/50, ATR, ADX, RSI + filtro AI).

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Frontend | React 19 + Tailwind CSS 4 + Lightweight Charts |
| API | Next.js API Routes (serverless) |
| Estado | Upstash Redis |
| Exchange | Binance REST API |
| Cron | cron-job.org (disparo cada 60s) |
| Notificaciones | Telegram |

## Estructura del proyecto

```
money-machine/
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # Layout root
│   │   ├── page.tsx                    # Dashboard principal
│   │   ├── globals.css                 # Estilos globales
│   │   └── api/
│   │       ├── data/route.ts           # GET /api/data → estado completo
│   │       ├── trades/route.ts         # GET /api/trades → historial
│   │       ├── config/route.ts         # GET/PUT /api/config
│   │       └── cron/
│   │           └── trade/route.ts      # POST /api/cron/trade → ciclo trading
│   │
│   ├── lib/
│   │   ├── config.ts                   # Zod schema + validación .env
│   │   ├── binance/
│   │   │   ├── client.ts               # Cliente REST Binance (klines, órdenes, cuenta)
│   │   │   └── types.ts                # Tipos Binance + parseKline
│   │   ├── strategy/
│   │   │   ├── types.ts                # Tipos de estrategia
│   │   │   ├── indicators.ts           # EMA, ATR, ADX, RSI desde cero
│   │   │   └── signal-engine.ts        # BUY/SELL/HOLD + confidence score
│   │   ├── ai/
│   │   │   └── filter.ts               # Filtro de confianza (score ≥ 0.75)
│   │   ├── risk/
│   │   │   └── manager.ts              # Drawdown 3%, cooldown, streaks, stake
│   │   ├── execution/
│   │   │   ├── types.ts                # Interfaz Executor
│   │   │   ├── factory.ts              # Crea executor según BOT_MODE
│   │   │   ├── binary-executor.ts      # CALL/PUT (paper + live)
│   │   │   ├── spot-executor.ts        # Market buy/sell (paper + live)
│   │   │   └── futures-executor.ts     # Long/Short con leverage
│   │   ├── state/
│   │   │   └── redis.ts                # Upstash Redis get/set/update
│   │   └── utils/
│   │       └── telegram.ts             # Notificaciones a Telegram
│   │
│   ├── components/
│   │   ├── Chart.tsx                   # Gráfico velas + EMAs (Lightweight Charts v5)
│   │   ├── MetricsBar.tsx              # Precio, Balance, Win Rate, P&L, Drawdown
│   │   ├── StrategyPanel.tsx           # Señal actual, indicadores, modo, posición
│   │   └── TradeHistory.tsx            # Tabla de trades con P&L
│   │
│   └── types/
│       └── index.ts                    # Tipos globales (Candle, Trade, Signal, BotState, etc.)
│
├── .env.example                        # Template de variables de entorno
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Variables de Entorno

Copia `.env.example` a `.env.local` y configura:

```bash
# Modo del bot
BOT_MODE=binary              # binary | spot | futures
BOT_PAPER=true               # true = paper trading, false = live real

# Binance API (solo necesarias si BOT_PAPER=false)
BINANCE_API_KEY=
BINANCE_SECRET_KEY=

# Mercado
SYMBOL=BTCUSDT
TIMEFRAME=1m

# Stake (tamaño de posición)
STAKE_MODE=fixed             # fixed | percent
STAKE_FIXED=50               # USDT si STAKE_MODE=fixed
STAKE_PERCENT=2              # % del balance si STAKE_MODE=percent
MAX_POSITION_USDT=100        # Límite máximo por posición

# Riesgo
RISK_PCT=0.01
COOLDOWN_SECONDS=60
LOSS_COOLDOWN_SECONDS=600
MAX_DAILY_DRAWDOWN_PCT=3

# Upstash Redis (necesario para estado persistente)
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=

# Telegram (opcional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## Instalación y ejecución local

```bash
# 1. Instalar dependencias
cd money-machine
npm install

# 2. Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con tus valores

# 3. Ejecutar en desarrollo
npm run dev
# Abrir http://localhost:3000

# 4. Build para producción
npm run build
npm start
```

## Despliegue en Vercel

```bash
# Instalar Vercel CLI
npm install -g vercel

# Desplegar
vercel --prod
```

O conectar el repositorio a [vercel.com](https://vercel.com).

**Importante**: Las variables de entorno deben configurarse también en el dashboard de Vercel (Settings → Environment Variables).

## Configurar cron externo (cron-job.org)

Vercel Hobby plan no permite cron jobs frecuentes, por lo que se usa un servicio externo:

1. Crear cuenta en [cron-job.org](https://cron-job.org)
2. Crear un nuevo job con:
   - **URL**: `https://tudominio.vercel.app/api/cron/trade`
   - **Method**: `POST`
   - **Interval**: cada `1 minuto`
   - **Request Body**: (vacío)

El endpoint `/api/cron/trade` ejecuta el ciclo completo cada vez que es llamado:
1. Obtiene velas de Binance REST
2. Calcula EMA3/8/50, ATR, ADX, RSI
3. Genera señal BUY/SELL/HOLD
4. Aplica filtro AI (requiere score ≥ 0.75)
5. Risk manager verifica drawdown, cooldown
6. Ejecuta trade según BOT_MODE
7. Guarda estado en Upstash Redis
8. Retorna resultado

## Modos de trading

### Binary Options (`BOT_MODE=binary`)
- CALL si la señal es BUY (apuesta a que el precio sube)
- PUT si la señal es SELL (apuesta a que el precio baja)
- Paga 90% en aciertos, pierde 100% en fallos

### Spot (`BOT_MODE=spot`)
- BUY: compra al precio de mercado
- SELL: vende al precio de mercado
- P&L = diferencia de precio × cantidad

### Futures (`BOT_MODE=futures`)
- LONG si la señal es BUY
- SHORT si la señal es SELL
- Apalancamiento fijo de 3x

## Estrategia de trading

### Indicadores técnicos
- **EMA3**, **EMA8**, **EMA50** — Medias móviles exponenciales
- **ATR(14)** — Volatilidad
- **ADX(14)** — Fuerza de la tendencia (requiere ≥ 15)
- **RSI(14)** — Momentum (requiere < 70 para BUY, > 30 para SELL)
- **Volatility Ratio** — (ATR / precio promedio) × 1000 (requiere ≥ 0.4)

### Señal BUY
`EMA3 > EMA8 AND close > EMA50 AND volatility >= 0.4 AND ADX >= 15 AND RSI < 70`

### Señal SELL
`EMA3 < EMA8 AND close < EMA50 AND volatility >= 0.4 AND ADX >= 15 AND RSI > 30`

### Filtro AI
Puntúa la señal 0-1 basado en:
- EMA gap ratio (30%)
- ADX / 40 (30%)
- Volatilidad (20%)
- Neutralidad RSI (20%)
- **Se rechaza si score < 0.75**

### Risk Management
- Drawdown máximo diario: 3% (detiene trading si se excede)
- Cooldown: 60s normal, 600s después de 3 pérdidas consecutivas
- Streak: después de 2 pérdidas seguidas, el stake se reduce a la mitad

## Dashboard

El dashboard en `/` muestra:
- **Métricas**: precio actual, balance, win rate, trades totales, P&L, drawdown
- **Gráfico**: velas OHLC con EMAs superpuestas (Lightweight Charts)
- **Panel de estrategia**: señal actual, indicadores, modo, estado de posición
- **Historial de trades**: tabla con side, entry, exit, stake, P&L, status

Los datos se actualizan vía SWR polling cada 5 segundos a `/api/data`.

## API endpoints

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/data` | GET | Estado completo del bot (precio, velas, señal, trades, balance) |
| `/api/trades` | GET | Últimos 50 trades |
| `/api/config` | GET | Configuración actual |
| `/api/config` | PUT | Actualizar configuración |
| `/api/cron/trade` | POST | Ejecutar ciclo de trading |

## Notificaciones Telegram

Si configuras `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`:
- Nuevo trade ejecutado → mensaje con side, stake, entry, confianza
- Trade cerrado → mensaje con P&L
- Modo paper vs live claramente indicado

## Licencia

MIT
