import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { parseUuid } from '../validation/sanitize.util';

@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  constructor(private readonly paramName = 'id') {}

  transform(value: string): string {
    const uuid = parseUuid(value);
    if (!uuid) {
      throw new BadRequestException(`Invalid ${this.paramName}: must be a valid UUID`);
    }
    return uuid;
  }
}
