import { Market } from '../markets';
import { TradeType, VWAP } from '../markets/ticker';
import { ExecutionStrategy } from './execution';
import { IEvent, EventImp } from '../utils';

import 'colors';

export enum ArbType {
    SIMPLE,
    COMPLEX,
    NONE 
}

export enum ArbConversionType {
    BUY_SIDE,
    SELL_SIDE,
    EITHER_SIDE,
    NONE
}

export enum InstructionType {
    DIRECT,
    ORIGIN_CONVERSION,
    DESTINATION_CONVERSION
}

export interface ExecutionOperation {
    exchange: string;
    hub: string;
    market: string;
    price: number;
    duration: number;
}

export interface ExecutionInstruction {
    id: string | null;
    spread: number;
    type: InstructionType;
    buy: ExecutionOperation;
    sell: ExecutionOperation;
    convert?: ExecutionOperation;
}

export class Arb {
    public type: ArbType;
    public conversionType: ArbConversionType;
    public originConversion: Market | null | undefined;
    public destinationConversion: Market | null | undefined;
    onUpdated: EventImp<ExecutionInstruction> = new EventImp<ExecutionInstruction>();
    public get updated() : IEvent<ExecutionInstruction> {
        return this.onUpdated.expose();
    };
    constructor(
        public originMarket: Market,
        public destinationMarket: Market
    ){
        // Find buy conversion market
        const originExchange = originMarket.hub.exchange;
        const originConversionHub = originExchange.hubs.get(destinationMarket.hub.asset.symbol);
        this.originConversion = originConversionHub ? originConversionHub.markets.get(originMarket.hub.asset.symbol) : null;
        // Find sell conversion market
        const destinationExchange = destinationMarket.hub.exchange;
        const destinationConversionHub = destinationExchange.hubs.get(originMarket.hub.asset.symbol);
        this.destinationConversion = destinationConversionHub ? destinationConversionHub.markets.get(destinationMarket.hub.asset.symbol) : null;
        if(originMarket.vwapSellStats.getVwap() === 0 || destinationMarket.vwapBuyStats.getVwap() === 0){
            this.type = ArbType.NONE;
            this.conversionType = ArbConversionType.NONE;
        }
        else if(this.originConversion || this.destinationConversion){
            this.type = ArbType.COMPLEX;
            if(this.originConversion && this.destinationConversion){
                this.conversionType = ArbConversionType.EITHER_SIDE;
            } else if(this.originConversion){
                this.conversionType = ArbConversionType.BUY_SIDE;
            }else if(this.destinationConversion){
                this.conversionType = ArbConversionType.SELL_SIDE;
            }else{
                this.conversionType = ArbConversionType.NONE;
            }
        }else if(this.isSimpleArb()){
            this.type = ArbType.SIMPLE;
            this.conversionType = ArbConversionType.NONE;
        }else {
            this.type = ArbType.NONE;
            this.conversionType = ArbConversionType.NONE;
        }
    }

    subscribeToVwap(event: IEvent<VWAP>) {
        event.on((vwap: VWAP | undefined) => {
            const instructions: ExecutionInstruction[] = this.getInstructions();
            instructions.forEach((inst: ExecutionInstruction)=>{
                // console.log(`VWAP Triggered Instructions: ${JSON.stringify(inst)}`);
                this.onUpdated.trigger(inst);
            });
        });
    }

    subscribeToEvents() {
        this.subscribeToVwap(this.destinationMarket.vwapBuyStats.vwapUpdated);
        this.subscribeToVwap(this.originMarket.vwapSellStats.vwapUpdated);
        if(this.originConversion){
            this.subscribeToVwap(this.originConversion.vwapSellStats.vwapUpdated);
        }
        if(this.destinationConversion){
            this.subscribeToVwap(this.destinationConversion.vwapBuyStats.vwapUpdated);
        }
    }

    getId() : string {
        const originExchange = this.originMarket.hub.exchange.id;
        const originConvert = this.originConversion ? this.originConversion.asset.symbol : 'NULL';
        const originMarket = this.originMarket.asset.symbol;
        const destinationExchange = this.destinationMarket.hub.exchange.id;
        const destinationMarket = this.destinationMarket.asset.symbol;
        const destinationConvert = this.destinationConversion ? this.destinationConversion.asset.symbol : 'NULL';
        return `${this.type}.${this.conversionType}.${originExchange}.${originConvert}.${originMarket}.${destinationExchange}${destinationConvert}${destinationMarket}`;
    }

    getInstId(instType: InstructionType) : string | null {
        const originExchange = this.originMarket.hub.exchange.id;
        const originHub = this.originMarket.hub.asset.symbol;
        const originMarket = this.originMarket.asset.symbol;
        const destinationExchange = this.destinationMarket.hub.exchange.id;
        const destinationHub = this.destinationMarket.hub.asset.symbol;
        const destinationMarket = this.destinationMarket.asset.symbol;
        const originConvert = this.originConversion ? this.originConversion.asset.symbol : null;
        const originConvertHub = this.originConversion ? this.originConversion.hub.asset.symbol : null;
        const destinationConvert = this.destinationConversion ? this.destinationConversion.asset.symbol : null;
        const destinationConvertHub = this.destinationConversion ? this.destinationConversion.hub.asset.symbol : null;
        
        const oHub = `${originExchange}.${originHub}`;
        const oMkt = `${originExchange}.${originMarket}`;
        const dHub = `${destinationExchange}.${destinationHub}`;
        const dMkt = `${destinationExchange}.${destinationMarket}`;
        const ocHub = `${originExchange}.${originConvertHub}`;
        const ocMkt = `${originExchange}.${originConvert}`;
        const dcHub = `${destinationExchange}.${destinationConvertHub}`;
        const dcMkt = `${destinationExchange}.${destinationConvert}`;

        if(instType as InstructionType === InstructionType.DIRECT){ // Direct Arb
            return `DA:${oHub}->${oMkt}->${dHub}`;
        }else if(instType as InstructionType === InstructionType.ORIGIN_CONVERSION) { // Origin Conversion
            return `OC:${ocHub}->${ocMkt}->${oMkt}->${dHub}`;
        }else if(instType as InstructionType === InstructionType.DESTINATION_CONVERSION){ // Destination Conversion
            return `DC:${oHub}->${dMkt}->${dcMkt}->${dcHub}`;
        }
        return null;
    }

    isSimpleArb() : boolean {
        const originHub = this.originMarket.hub.asset.symbol;
        const originExchange = this.originMarket.hub.exchange.id;
        const destinationHub = this.destinationMarket.hub.asset.symbol;
        const destinationExchange = this.destinationMarket.hub.exchange.id;
        const isSameHub = originHub === destinationHub;
        const isSameExchange = originExchange === destinationExchange;
        const isSimple = (isSameHub && !isSameExchange);
        return isSimple;
    }

    getSpread(){
        const spread = this.destinationMarket.vwapBuyStats.getVwap() - this.originMarket.vwapSellStats.getVwap();
        return spread;
    }

    getSpreadPercent(){
        const spread = this.getSpread();
        if(this.originMarket.vwapSellStats.getVwap() === 0){
            return Number.NaN;
        }else{
            return spread / this.originMarket.vwapSellStats.getVwap();
        }
    }

    getOriginConversionSpread(){
        if(this.originConversion){
            return this.destinationMarket.vwapBuyStats.getVwap() - this.originMarket.vwapSellStats.getVwap() * this.originConversion.vwapSellStats.getVwap();
        }else{
            return Number.NaN;
        }
    }

    getOriginConversionSpreadPercent(){
        if(this.originConversion){
            const initialValue = this.originMarket.vwapSellStats.getVwap() * this.originConversion.vwapSellStats.getVwap();
            if(initialValue === 0){
                return Number.NaN;
            }else{
                return this.getOriginConversionSpread() / initialValue;
            }
        }else{
            return Number.NaN;
        }
    }

    getDestinationConversionSpread(){
        if(this.destinationConversion){
            return this.destinationMarket.vwapBuyStats.getVwap() * this.destinationConversion.vwapBuyStats.getVwap() - this.originMarket.vwapSellStats.getVwap();
        }else{
            return Number.NaN;
        }
    }

    getDestinationConversionSpreadPercent(){
        if(this.destinationConversion){
            const initialValue = this.originMarket.vwapSellStats.getVwap();
            if(initialValue === 0){
                return Number.NaN;
            }else{
                return this.getDestinationConversionSpread() / initialValue;
            }
        }else{
            return Number.NaN;
        }
    }

    getConversionSpreadPercent(){
        const originConversionSpread = this.getOriginConversionSpreadPercent();
        const destinationConversionSpread = this.getDestinationConversionSpreadPercent();
        return this.getBetterSpread(originConversionSpread, destinationConversionSpread);
    }

    getConversionSpread(){
        const originConversionSpread = this.getOriginConversionSpread();
        const destinationConversionSpread = this.getDestinationConversionSpread();
        return this.getBetterSpread(originConversionSpread, destinationConversionSpread);
    }

    getBetterSpread(originConversionSpread: number, destinationConversionSpread: number){
        const hasOriginConversion = !Number.isNaN(originConversionSpread);
        const hasDestinationConversion = !Number.isNaN(destinationConversionSpread);

        if(this.conversionType === ArbConversionType.EITHER_SIDE){
            if(Math.abs(destinationConversionSpread) < Math.abs(originConversionSpread)){
                return originConversionSpread;
            }else{
                return destinationConversionSpread;
            }
        }else if(this.conversionType === ArbConversionType.BUY_SIDE){
            return originConversionSpread;
        }else if(this.conversionType === ArbConversionType.SELL_SIDE){
            return destinationConversionSpread;
        }else{
            console.log(`Missing conversion markets!`);
            return Number.NaN;
        }
    }

    public getBuyOperation() : ExecutionOperation {
        return {
            exchange: this.originMarket.hub.exchange.id,
            hub: this.originMarket.hub.asset.symbol,
            market: this.originMarket.asset.symbol,
            price: this.originMarket.vwapSellStats.getVwap(),
            duration: this.originMarket.vwapSellStats.getDuration()
        };
    }

    public getSellOperation() : ExecutionOperation {
        return {
            exchange: this.destinationMarket.hub.exchange.id,
            hub: this.destinationMarket.hub.asset.symbol,
            market: this.destinationMarket.asset.symbol,
            price: this.destinationMarket.vwapBuyStats.getVwap(),
            duration: this.destinationMarket.vwapBuyStats.getDuration()
        };
    }

    public getOriginConvOperation() : ExecutionOperation | null {
        if(this.originConversion){
            return {
                exchange: this.originConversion.hub.exchange.id,
                hub: this.originConversion.hub.asset.symbol,
                market: this.originConversion.asset.symbol,
                price: this.originConversion.vwapSellStats.getVwap(),
                duration: this.originConversion.vwapSellStats.getDuration()
            };
        }else{
            return null;
        }
    }

    public getDestinationConvOperation() : ExecutionOperation | null {
        if(this.destinationConversion){
            return {
                exchange: this.destinationConversion.hub.exchange.id,
                hub: this.destinationConversion.hub.asset.symbol,
                market: this.destinationConversion.asset.symbol,
                price: this.destinationConversion.vwapBuyStats.getVwap(),
                duration: this.destinationConversion.vwapBuyStats.getDuration()
            };
        }else{
            return null;
        }
    }

    public getDirectInstructions() : ExecutionInstruction | null {
        const spread = this.getSpreadPercent();
        const buy = this.getBuyOperation();
        const sell = this.getSellOperation();
        const instructions = {
            id: this.getInstId(InstructionType.DIRECT),
            spread: spread,
            type: InstructionType.DIRECT,
            buy: buy,
            sell: sell
        };
        return instructions;
    }

    public getOriginConvertInstructions() : ExecutionInstruction | null {
        const buyConvertSpread = this.getOriginConversionSpreadPercent();
        const buy = this.getBuyOperation();
        const sell = this.getSellOperation();
        const buyConvert = this.getOriginConvOperation();
        if(buyConvert){
            const instructions = {
                id: this.getInstId(InstructionType.ORIGIN_CONVERSION),
                spread: buyConvertSpread,
                type: InstructionType.ORIGIN_CONVERSION,
                buy: buy,
                sell: sell,
                convert: buyConvert
            };
            return instructions;
        }else{
            return null;
        }
    }

    public getDestinationConvertInstructions() : ExecutionInstruction | null {
        const sellConvertSpread = this.getDestinationConversionSpreadPercent();
        const buy = this.getBuyOperation();
        const sell = this.getSellOperation();
        const sellConvert = this.getDestinationConvOperation();
        if(sellConvert){
            const instructions = {
                id: this.getInstId(InstructionType.DESTINATION_CONVERSION),
                spread: sellConvertSpread,
                type: InstructionType.DESTINATION_CONVERSION,
                buy: buy,
                sell: sell,
                convert: sellConvert
            };
            return instructions;
        }else{
            return null;
        }
    }

    public getInstructions() : ExecutionInstruction[] {
        const instructions: ExecutionInstruction[] = [];
        if(this.type === ArbType.SIMPLE){
            const instruction = this.getDirectInstructions();
            if(instruction && !Number.isNaN(instruction.spread)){
                instructions.push(instruction);
            }
        }else if(this.type === ArbType.COMPLEX){
            if(this.conversionType === ArbConversionType.EITHER_SIDE){
                const sellConvertInstruction = this.getDestinationConvertInstructions();
                if(sellConvertInstruction && !Number.isNaN(sellConvertInstruction.spread)){
                    instructions.push(sellConvertInstruction);
                }
                const buyConvertInstruction = this.getOriginConvertInstructions();
                if(buyConvertInstruction && ! !Number.isNaN(buyConvertInstruction.spread)){
                    instructions.push(buyConvertInstruction);
                }
            }else if(this.conversionType === ArbConversionType.BUY_SIDE){
                const buyConvertInstruction = this.getOriginConvertInstructions();
                if(buyConvertInstruction && !Number.isNaN(buyConvertInstruction.spread)){
                    instructions.push(buyConvertInstruction);
                }
            }else if(this.conversionType === ArbConversionType.SELL_SIDE){
                const sellConvertInstruction = this.getDestinationConvertInstructions();
                if(sellConvertInstruction && !Number.isNaN(sellConvertInstruction.spread)){
                    instructions.push(sellConvertInstruction);
                }
            }else{
                console.log(`No Conversion Type.`);
            }
        }else{
            console.log(`No Arb Type.`);
        }
        return instructions;
    }
}