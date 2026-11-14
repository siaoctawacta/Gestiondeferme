import {
  Body,
  Controller,
  Delete,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { RequirePermission } from '../src/access/decorators';
import { Audited } from '../src/audit/audited.decorator';
import type { AuditableService } from '../src/audit/audited.decorator';

class ProbeItemDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

interface Item {
  id: string;
  name: string;
  passwordHash: string;
  nested: { tokenHash: string; list: { backupCodes: string[] }[] };
}

/** Test-only in-memory store standing in for a Task 6 service. */
@Injectable()
export class ProbeItemsService implements AuditableService {
  private readonly items = new Map<string, Item>();
  private seq = 0;

  create(name: string): Item {
    this.seq += 1;
    const item: Item = {
      id: `probe-${this.seq}`,
      name,
      passwordHash: 'argon2-secret',
      nested: { tokenHash: 'abc', list: [{ backupCodes: ['1', '2'] }] },
    };
    this.items.set(item.id, item);
    return item;
  }

  update(id: string, name: string): Item {
    const item = this.items.get(id);
    if (!item) throw new NotFoundException();
    item.name = name;
    return { ...item };
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  findForAudit(id: string): Promise<unknown> {
    const item = this.items.get(id);
    return Promise.resolve(item ? { ...item } : null);
  }
}

/** Test-only controller. Registered by createTestApp, never by AppModule. */
@Controller('_audit_probe')
export class AuditProbeController {
  constructor(private readonly items: ProbeItemsService) {}

  @Post()
  @RequirePermission('lots', 'create')
  @Audited('lots', { entity: ProbeItemsService })
  create(@Body() dto: ProbeItemDto) {
    return this.items.create(dto.name);
  }

  @Patch(':id')
  @RequirePermission('lots', 'update')
  @Audited('lots', { entity: ProbeItemsService })
  update(@Param('id') id: string, @Body() dto: ProbeItemDto) {
    return this.items.update(id, dto.name);
  }

  @Delete(':id')
  @RequirePermission('lots', 'delete')
  @Audited('lots', { entity: ProbeItemsService })
  remove(@Param('id') id: string): void {
    this.items.remove(id);
  }

  /** Same shape as `create` but without `@Audited`: must leave no trace. */
  @Post('silent')
  @RequirePermission('lots', 'create')
  silent(@Body() dto: ProbeItemDto) {
    return this.items.create(dto.name);
  }
}
