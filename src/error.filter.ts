import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { Response } from "express";
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException)
      return response.status(error.getStatus()).json(error.getResponse());
    if (error instanceof QueryFailedError) {
      const code = String((error.driverError as { code?: string }).code);
      if (
        [
          "23505",
          "ER_DUP_ENTRY",
          "23503",
          "ER_ROW_IS_REFERENCED_2",
          "ER_NO_REFERENCED_ROW_2",
        ].includes(code)
      )
        return response.status(409).json({
          statusCode: 409,
          message: "Unique or reference constraint conflict",
        });
      if (
        [
          "22P02",
          "22003",
          "22007",
          "ER_TRUNCATED_WRONG_VALUE",
          "ER_WRONG_VALUE",
          "ER_DATA_OUT_OF_RANGE",
        ].includes(code)
      )
        return response
          .status(400)
          .json({ statusCode: 400, message: "Invalid query value" });
    }
    this.logger.error(
      error instanceof Error ? error.message : "Unexpected error",
    );
    return response
      .status(500)
      .json({ statusCode: 500, message: "Internal server error" });
  }
}
