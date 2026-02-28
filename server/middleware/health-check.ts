import { Request, Response } from 'express';
import { rabbitMQClient } from '../services/rabbitmq-client';
import { priceService } from '../services/price-service';

export async function tradingHealthCheck(req: Request, res: Response) {
    const rabbitmqConnected = rabbitMQClient.isConnected();
    const btcPriceData = priceService.getPrice('BTC');
    const priceAvailable = btcPriceData !== null;

    const status = {
        trading: rabbitmqConnected && priceAvailable ? 'operational' : 'degraded',
        services: {
            rabbitmq: {
                status: rabbitmqConnected ? 'connected' : 'disconnected',
                required: true
            },
            priceFeeds: {
                status: priceAvailable ? 'available' : 'unavailable',
                required: true,
                lastPrice: btcPriceData?.price || null,
                source: btcPriceData?.source || 'none'
            }
        },
        timestamp: new Date().toISOString()
    };

    // Return 503 if any required service is down
    const httpStatus = status.trading === 'operational' ? 200 : 503;
    res.status(httpStatus).json(status);
}
