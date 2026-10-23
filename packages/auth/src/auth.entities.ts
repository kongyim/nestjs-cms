import { EntitySchema } from "typeorm";

export const Credential = new EntitySchema<{
  userId: string;
  passwordHash: string;
}>({
  name: "admin_credentials",
  columns: {
    userId: { type: String, length: 36, primary: true },
    passwordHash: { type: String, length: 256 },
  },
  foreignKeys: [
    {
      target: "users",
      columnNames: ["userId"],
      referencedColumnNames: ["id"],
      onDelete: "CASCADE",
    },
  ],
});

export const Session = new EntitySchema<{
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}>({
  name: "admin_sessions",
  columns: {
    tokenHash: { type: String, length: 64, primary: true },
    userId: { type: String, length: 36 },
    expiresAt: { type: Date },
  },
  foreignKeys: [
    {
      target: "users",
      columnNames: ["userId"],
      referencedColumnNames: ["id"],
      onDelete: "CASCADE",
    },
  ],
});
