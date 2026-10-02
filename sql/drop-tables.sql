/* ============================================================================
   SuperGestion — Réinitialisation du schéma (ATTENTION : destruction des données)
   Usage : sqlcmd -S "localhost\DEVPERSO" -U sa -P "…" -i sql/drop-tables.sql -d supergestion
   (ordre enfants → parents ; les cascades couvrent les lignes de détail)
   ========================================================================== */

USE supergestion;
GO

IF OBJECT_ID(N'dbo.sg_audit_log', N'U') IS NOT NULL DROP TABLE dbo.sg_audit_log;
IF OBJECT_ID(N'dbo.sg_cash_session_ticket', N'U') IS NOT NULL DROP TABLE dbo.sg_cash_session_ticket;
IF OBJECT_ID(N'dbo.sg_cash_session', N'U') IS NOT NULL DROP TABLE dbo.sg_cash_session;
IF OBJECT_ID(N'dbo.sg_sale_payment', N'U') IS NOT NULL DROP TABLE dbo.sg_sale_payment;
IF OBJECT_ID(N'dbo.sg_sale_item', N'U') IS NOT NULL DROP TABLE dbo.sg_sale_item;
IF OBJECT_ID(N'dbo.sg_sale', N'U') IS NOT NULL DROP TABLE dbo.sg_sale;
IF OBJECT_ID(N'dbo.sg_purchase_order_item', N'U') IS NOT NULL DROP TABLE dbo.sg_purchase_order_item;
IF OBJECT_ID(N'dbo.sg_purchase_order', N'U') IS NOT NULL DROP TABLE dbo.sg_purchase_order;
IF OBJECT_ID(N'dbo.sg_transfer_item', N'U') IS NOT NULL DROP TABLE dbo.sg_transfer_item;
IF OBJECT_ID(N'dbo.sg_transfer_order', N'U') IS NOT NULL DROP TABLE dbo.sg_transfer_order;
IF OBJECT_ID(N'dbo.sg_stock_movement', N'U') IS NOT NULL DROP TABLE dbo.sg_stock_movement;
IF OBJECT_ID(N'dbo.sg_batch', N'U') IS NOT NULL DROP TABLE dbo.sg_batch;
IF OBJECT_ID(N'dbo.sg_product', N'U') IS NOT NULL DROP TABLE dbo.sg_product;
IF OBJECT_ID(N'dbo.sg_supplier', N'U') IS NOT NULL DROP TABLE dbo.sg_supplier;
IF OBJECT_ID(N'dbo.sg_store', N'U') IS NOT NULL DROP TABLE dbo.sg_store;
IF OBJECT_ID(N'dbo.sg_user', N'U') IS NOT NULL DROP TABLE dbo.sg_user;
IF OBJECT_ID(N'dbo.sg_tenant', N'U') IS NOT NULL DROP TABLE dbo.sg_tenant;
IF OBJECT_ID(N'dbo.sg_tenants', N'U') IS NOT NULL DROP TABLE dbo.sg_tenants;
GO

PRINT N'Tables SuperGestion supprimées. Exécutez ensuite sql/schema.sql pour reconstruire.';
GO
