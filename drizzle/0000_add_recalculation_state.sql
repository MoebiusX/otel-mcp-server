CREATE TABLE "anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"span_id" varchar(64) NOT NULL,
	"service" varchar(100) NOT NULL,
	"operation" varchar(255) NOT NULL,
	"duration" numeric(18, 4) NOT NULL,
	"expected_mean" numeric(18, 4) NOT NULL,
	"expected_std_dev" numeric(18, 4) NOT NULL,
	"deviation" numeric(10, 4) NOT NULL,
	"severity" integer NOT NULL,
	"severity_name" varchar(20) NOT NULL,
	"attributes" jsonb,
	"day_of_week" integer,
	"hour_of_day" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"data" jsonb,
	"documents" jsonb,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewer_notes" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar(50),
	"user_id" uuid NOT NULL,
	"pair" varchar(20) NOT NULL,
	"side" varchar(4) NOT NULL,
	"type" varchar(10) NOT NULL,
	"price" numeric(24, 8),
	"quantity" numeric(24, 8) NOT NULL,
	"filled" numeric(24, 8) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"trace_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "recalculation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" varchar(100) NOT NULL,
	"last_processed_at" timestamp with time zone NOT NULL,
	"last_trace_time" numeric(20, 0),
	"processing_status" varchar(50) DEFAULT 'idle' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recalculation_state_service_unique" UNIQUE("service")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" varchar(255) NOT NULL,
	"user_agent" text,
	"ip_address" varchar(45),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "span_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"span_key" varchar(255) NOT NULL,
	"service" varchar(100) NOT NULL,
	"operation" varchar(255) NOT NULL,
	"mean" numeric(18, 4) NOT NULL,
	"std_dev" numeric(18, 4) NOT NULL,
	"variance" numeric(24, 8) NOT NULL,
	"p50" numeric(18, 4),
	"p95" numeric(18, 4),
	"p99" numeric(18, 4),
	"min" numeric(18, 4),
	"max" numeric(18, 4),
	"sample_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "span_baselines_span_key_unique" UNIQUE("span_key")
);
--> statement-breakpoint
CREATE TABLE "time_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"span_key" varchar(255) NOT NULL,
	"service" varchar(100) NOT NULL,
	"operation" varchar(255) NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour_of_day" integer NOT NULL,
	"mean" numeric(18, 4) NOT NULL,
	"std_dev" numeric(18, 4) NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"thresholds" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_order_id" uuid,
	"seller_order_id" uuid,
	"pair" varchar(20) NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"buyer_fee" numeric(24, 8) DEFAULT '0' NOT NULL,
	"seller_fee" numeric(24, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"fee" numeric(24, 8) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"reference_id" varchar(255),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"password_hash" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"kyc_level" integer DEFAULT 0 NOT NULL,
	"two_factor_secret" varchar(64),
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"two_factor_backup_codes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" varchar(6) NOT NULL,
	"type" varchar(10) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset" varchar(10) NOT NULL,
	"balance" numeric(24, 8) DEFAULT '0' NOT NULL,
	"available" numeric(24, 8) DEFAULT '0' NOT NULL,
	"locked" numeric(24, 8) DEFAULT '0' NOT NULL,
	"address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_order_id_orders_id_fk" FOREIGN KEY ("buyer_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_order_id_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_anomalies_service" ON "anomalies" USING btree ("service");--> statement-breakpoint
CREATE INDEX "idx_anomalies_severity" ON "anomalies" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_anomalies_created" ON "anomalies" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_anomalies_trace" ON "anomalies" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_pair_status" ON "orders" USING btree ("pair","status");--> statement-breakpoint
CREATE INDEX "idx_span_baselines_service" ON "span_baselines" USING btree ("service");--> statement-breakpoint
CREATE UNIQUE INDEX "time_baselines_key_day_hour" ON "time_baselines" USING btree ("span_key","day_of_week","hour_of_day");--> statement-breakpoint
CREATE INDEX "idx_time_baselines_span" ON "time_baselines" USING btree ("span_key");--> statement-breakpoint
CREATE INDEX "idx_trades_pair" ON "trades" USING btree ("pair");--> statement-breakpoint
CREATE INDEX "idx_transactions_user" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_wallet" ON "transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_verification_codes_user" ON "verification_codes" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_wallets_user" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_asset_unique" ON "wallets" USING btree ("user_id","asset");--> statement-breakpoint
CREATE INDEX "idx_wallets_address" ON "wallets" USING btree ("address");