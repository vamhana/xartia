// =============================================================================
// XartIA subgraph — AssemblyScript handlers
//
// Block: O.2.01.01
// Depends on: C.10.01.01 (Events), O.2.01.02 (subgraph.yaml), O.2.01.03 (schema)
//
// ВАЖНО для индексатора (R.1.01.01 / R.2.01.04):
//   - Buy при каскаде (buyFromPool → buyFromCurveFor) имеет fee = 0 и usdcIn = normalized X_18.
//   - BuyFromPool — источник истины для полной суммы покупки (usdcIn = X_18, fee = fee_18).
//   - Если в одной транзакции есть и Buy, и BuyFromPool — НЕ суммировать для агрегатов.
//     Buy используется только для получения ΔS_curve (tokensFromCurve).
//   - Sweep-dust (шаг 11b buyFromPool) НЕ эмитит событие — reserve растёт молча (≤ 2 wei-6).
//   - sellTeamFee в Redeem/SellToPool — часть gross, уходящая в treasury.
// =============================================================================

import {
  Buy as BuyEvent,
  Redeem as RedeemEvent,
  SellTeamFeeUpdated as SellTeamFeeUpdatedEvent,
  PoolPriceUpdated as PoolPriceUpdatedEvent,
  PoolPriceInitialized as PoolPriceInitializedEvent,
  LevelChanged as LevelChangedEvent,
  CircuitBreakerTriggered as CircuitBreakerTriggeredEvent,
  TeamFee as TeamFeeEvent,
} from "../generated/CurveController/CurveController";

import {
  BuyFromPool as BuyFromPoolEvent,
  SellToPool as SellToPoolEvent,
  PoolPriceUpdated as PoolPriceUpdatedEventPool,
} from "../generated/PoolController/PoolController";

import {
  Buy,
  BuyFromPool,
  Sell,
  Redeem,
  PoolPrice,
  Level,
  User,
  Treasury,
  SellTeamFeeUpdate,
  ProtocolStats,
} from "../generated/schema";

import { BigInt, Bytes, Address, BigDecimal } from "@graphprotocol/graph-ts";

const TREASURY_ID = "treasury";
const STATS_ID = "stats";
const ZERO_BI = BigInt.fromI32(0);

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function loadOrCreateUser(address: Address, timestamp: BigInt): User {
  let id = address.toHexString();
  let user = User.load(id);
  if (user == null) {
    user = new User(id);
    user.buys = ZERO_BI;
    user.sells = ZERO_BI;
    user.redeems = ZERO_BI;
    user.balance = ZERO_BI;
    user.firstSeenAt = timestamp;
  }
  user.lastSeenAt = timestamp;
  return user as User;
}

function loadOrCreateTreasury(timestamp: BigInt, block: BigInt): Treasury {
  let t = Treasury.load(TREASURY_ID);
  if (t == null) {
    t = new Treasury(TREASURY_ID);
    t.balance = ZERO_BI;
    t.totalCollected = ZERO_BI;
    t.lastUpdatedAt = timestamp;
    t.lastUpdatedBlock = block;
  }
  return t as Treasury;
}

function loadOrCreateStats(timestamp: BigInt, block: BigInt): ProtocolStats {
  let s = ProtocolStats.load(STATS_ID);
  if (s == null) {
    s = new ProtocolStats(STATS_ID);
    s.currentSellTeamFee = BigInt.fromI32(10); // default
    s.currentBuyFee = BigInt.fromI32(50);
    s.currentRedeemFee = BigInt.fromI32(50);
    s.roundTripCost = BigInt.fromI32(110);
    s.lastUpdatedAt = timestamp;
    s.lastUpdatedBlock = block;
  }
  return s as ProtocolStats;
}

// -----------------------------------------------------------------------------
// CurveController handlers
// -----------------------------------------------------------------------------

export function handleBuy(event: BuyEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let b = new Buy(id);
  b.buyer = event.params.buyer;
  b.usdcIn = event.params.usdcIn;
  b.tokensOut = event.params.tokensOut;
  b.fee = event.params.fee;
  b.teamTokens = event.params.teamTokens;
  b.newScurve = event.params.newScurve;
  b.newReserve = event.params.newReserve;
  b.newLevel = event.params.newLevel;
  b.timestamp = event.block.timestamp;
  b.block = event.block.number;
  b.txHash = event.transaction.hash;
  b.save();

  let user = loadOrCreateUser(event.params.buyer, event.block.timestamp);
  user.buys = user.buys.plus(BigInt.fromI32(1));
  user.balance = user.balance.plus(event.params.tokensOut);
  user.save();
}

export function handleRedeem(event: RedeemEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let r = new Redeem(id);
  r.seller = event.params.seller;
  r.tokensIn = event.params.tokensIn;
  r.usdcOut = event.params.usdcOut;
  r.fee = event.params.fee;
  r.earlyFee = event.params.earlyFee;
  r.sellTeamFee = event.params.sellTeamFee;
  r.newScurve = event.params.newScurve;
  r.newReserve = event.params.newReserve;
  r.newLevel = event.params.newLevel;
  r.timestamp = event.block.timestamp;
  r.block = event.block.number;
  r.txHash = event.transaction.hash;
  r.save();

  let user = loadOrCreateUser(event.params.seller, event.block.timestamp);
  user.redeems = user.redeems.plus(BigInt.fromI32(1));
  if (user.balance.gt(event.params.tokensIn)) {
    user.balance = user.balance.minus(event.params.tokensIn);
  } else {
    user.balance = ZERO_BI;
  }
  user.save();

  // treasury += sellTeamFee (в 18-dec)
  if (event.params.sellTeamFee.gt(ZERO_BI)) {
    let t = loadOrCreateTreasury(event.block.timestamp, event.block.number);
    let delta6 = event.params.sellTeamFee.div(BigInt.fromI32(10).pow(12));
    t.balance = t.balance.plus(delta6);
    t.totalCollected = t.totalCollected.plus(delta6);
    t.lastUpdatedAt = event.block.timestamp;
    t.lastUpdatedBlock = event.block.number;
    t.save();
  }
}

export function handleSellTeamFeeUpdated(event: SellTeamFeeUpdatedEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let u = new SellTeamFeeUpdate(id);
  u.oldFee = event.params.oldFee;
  u.newFee = event.params.newFee;
  u.timestamp = event.block.timestamp;
  u.block = event.block.number;
  u.txHash = event.transaction.hash;
  u.save();

  let s = loadOrCreateStats(event.block.timestamp, event.block.number);
  s.currentSellTeamFee = event.params.newFee;
  s.roundTripCost = s.currentBuyFee.plus(s.currentRedeemFee).plus(event.params.newFee);
  s.lastUpdatedAt = event.block.timestamp;
  s.lastUpdatedBlock = event.block.number;
  s.save();
}

export function handlePoolPriceUpdated(event: PoolPriceUpdatedEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let p = new PoolPrice(id);
  p.price = event.params.newPrice;
  p.oldPrice = event.params.oldPrice;
  p.timestamp = event.block.timestamp;
  p.block = event.block.number;
  p.txHash = event.transaction.hash;
  p.source = "CurveController";
  p.save();
}

export function handlePoolPriceInitialized(event: PoolPriceInitializedEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let p = new PoolPrice(id);
  p.price = event.params.initialPrice;
  p.oldPrice = ZERO_BI;
  p.timestamp = event.block.timestamp;
  p.block = event.block.number;
  p.txHash = event.transaction.hash;
  p.source = "init";
  p.save();
}

export function handleLevelChanged(event: LevelChangedEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let l = new Level(id);
  l.oldLevel = event.params.oldLevel;
  l.newLevel = event.params.newLevel;
  l.timestamp = event.block.timestamp;
  l.block = event.block.number;
  l.txHash = event.transaction.hash;
  l.save();
}

export function handleCircuitBreakerTriggered(event: CircuitBreakerTriggeredEvent): void {
  // log only, no entity (can extend with `CircuitBreakerEvent` entity if needed)
}

export function handleTeamFee(event: TeamFeeEvent): void {
  // log only, teamTokens — часть Buy.teamTokens, отдельная сущность не нужна.
}

// -----------------------------------------------------------------------------
// PoolController handlers
// -----------------------------------------------------------------------------

export function handleBuyFromPool(event: BuyFromPoolEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let b = new BuyFromPool(id);
  b.buyer = event.params.buyer;
  b.usdcIn = event.params.usdcIn;
  b.tokensFromPool = event.params.tokensFromPool;
  b.tokensFromCurve = event.params.tokensFromCurve;
  b.fee = event.params.fee;
  b.newPool = event.params.newPool;
  b.newPoolPrice = event.params.newPoolPrice;
  b.newScurve = event.params.newScurve;
  b.newReserve = event.params.newReserve;
  b.timestamp = event.block.timestamp;
  b.block = event.block.number;
  b.txHash = event.transaction.hash;
  b.save();

  let user = loadOrCreateUser(event.params.buyer, event.block.timestamp);
  user.buys = user.buys.plus(BigInt.fromI32(1));
  user.balance = user.balance.plus(event.params.tokensFromPool).plus(event.params.tokensFromCurve);
  user.save();
}

export function handleSellToPool(event: SellToPoolEvent): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let s = new Sell(id);
  s.seller = event.params.seller;
  s.tokensIn = event.params.tokensIn;
  s.usdcOut = event.params.usdcOut;
  s.fee = event.params.fee;
  s.sellTeamFee = event.params.sellTeamFee;
  s.newPool = event.params.newPool;
  s.newPoolPrice = event.params.newPoolPrice;
  s.newReserve = event.params.newReserve;
  s.timestamp = event.block.timestamp;
  s.block = event.block.number;
  s.txHash = event.transaction.hash;
  s.save();

  let user = loadOrCreateUser(event.params.seller, event.block.timestamp);
  user.sells = user.sells.plus(BigInt.fromI32(1));
  if (user.balance.gt(event.params.tokensIn)) {
    user.balance = user.balance.minus(event.params.tokensIn);
  } else {
    user.balance = ZERO_BI;
  }
  user.save();

  // treasury += sellTeamFee
  if (event.params.sellTeamFee.gt(ZERO_BI)) {
    let t = loadOrCreateTreasury(event.block.timestamp, event.block.number);
    let delta6 = event.params.sellTeamFee.div(BigInt.fromI32(10).pow(12));
    t.balance = t.balance.plus(delta6);
    t.totalCollected = t.totalCollected.plus(delta6);
    t.lastUpdatedAt = event.block.timestamp;
    t.lastUpdatedBlock = event.block.number;
    t.save();
  }
}

export function handlePoolPriceUpdatedPool(event: PoolPriceUpdatedEventPool): void {
  // Из PoolController — тот же handler, что из CurveController.
  // Дублирование безопасно: два разных event source, но обе пишут PoolPrice.
  // (Спека: PoolPriceUpdated эмитится и CurveController'ом, и PoolController'ом.)
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let p = new PoolPrice(id);
  p.price = event.params.newPrice;
  p.oldPrice = event.params.oldPrice;
  p.timestamp = event.block.timestamp;
  p.block = event.block.number;
  p.txHash = event.transaction.hash;
  p.source = "PoolController";
  p.save();
}