export enum TradeType {
	BUY,
	SELL
}

export enum InitiationType {
	Maker,
	Taker
}

export enum ArbType {
	MakerDirect,
	TakerDirect,
	MakerOriginConversion,
	TakerOriginConversion,
	MakerDestinationConversion,
	TakerDestinationConversion
}

export enum TimeUnit {
	MILLISECOND,
	SECOND,
	MINUTE,
	HOUR
}
