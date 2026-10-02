CREATE TABLE "payment_discrepancies" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"order_id" text NOT NULL,
	"order_type" text NOT NULL,
	"event_id" text,
	"buyer_email" text DEFAULT '' NOT NULL,
	"buyer_name" text DEFAULT '' NOT NULL,
	"flw_tx_ref" text,
	"flw_transaction_id" text NOT NULL,
	"expected_minor" integer NOT NULL,
	"paid_minor" integer,
	"paid_currency" text DEFAULT 'NGN' NOT NULL,
	"owed_minor" integer,
	"reason" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_fee_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"changed_by" text,
	"changed_by_name" text DEFAULT '' NOT NULL,
	"changed_by_email" text DEFAULT '' NOT NULL,
	"previous_ticket_fee_bps" integer NOT NULL,
	"previous_registration_fee_bps" integer NOT NULL,
	"previous_vote_fee_bps" integer NOT NULL,
	"ticket_fee_bps" integer NOT NULL,
	"registration_fee_bps" integer NOT NULL,
	"vote_fee_bps" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"ticket_fee_bps" integer DEFAULT 500 NOT NULL,
	"registration_fee_bps" integer DEFAULT 500 NOT NULL,
	"vote_fee_bps" integer DEFAULT 500 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_single_row" CHECK ("platform_settings"."id" = 'global'),
	CONSTRAINT "platform_settings_ticket_fee_bps_range" CHECK ("platform_settings"."ticket_fee_bps" >= 0 and "platform_settings"."ticket_fee_bps" <= 10000),
	CONSTRAINT "platform_settings_registration_fee_bps_range" CHECK ("platform_settings"."registration_fee_bps" >= 0 and "platform_settings"."registration_fee_bps" <= 10000),
	CONSTRAINT "platform_settings_vote_fee_bps_range" CHECK ("platform_settings"."vote_fee_bps" >= 0 and "platform_settings"."vote_fee_bps" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "payment_discrepancies" ADD CONSTRAINT "payment_discrepancies_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "platform_fee_changes" ADD CONSTRAINT "platform_fee_changes_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_discrepancies_charge_idx" ON "payment_discrepancies" USING btree ("order_id","flw_transaction_id","kind");--> statement-breakpoint
CREATE INDEX "payment_discrepancies_status_idx" ON "payment_discrepancies" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "payment_discrepancies_order_idx" ON "payment_discrepancies" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_discrepancies_buyer_email_idx" ON "payment_discrepancies" USING btree ("buyer_email");--> statement-breakpoint
CREATE INDEX "platform_fee_changes_created_idx" ON "platform_fee_changes" USING btree ("created_at");