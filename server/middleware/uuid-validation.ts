import { Request, Response, NextFunction } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUUID(field: string = 'userId') {
    return (req: Request, res: Response, next: NextFunction) => {
        const value = req.body[field] || req.query[field] || req.params[field];

        if (!value) {
            return res.status(400).json({
                error: `${field} is required`,
                field
            });
        }

        if (!UUID_REGEX.test(value)) {
            return res.status(400).json({
                error: `${field} must be a valid UUID`,
                field,
                received: value
            });
        }

        next();
    };
}

// Helper function to validate UUID format
export function isValidUUID(uuid: string): boolean {
    return UUID_REGEX.test(uuid);
}
