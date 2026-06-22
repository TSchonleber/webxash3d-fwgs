use anchor_lang::prelude::*;

declare_id!("6jSjkNJg2ap9Mxmj6prQ7bEnBQsSWvf6t5p5vWLBzSx4");

#[program]
pub mod distributor {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, oracle: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.oracle = oracle;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_oracle(ctx: Context<SetOracle>, new_oracle: Pubkey) -> Result<()> {
        ctx.accounts.config.oracle = new_oracle;
        Ok(())
    }

    pub fn init_vault(ctx: Context<InitVault>) -> Result<()> {
        ctx.accounts.vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn publish_period(
        ctx: Context<PublishPeriod>,
        period_id: u64,
        merkle_root: [u8; 32],
        total_amount: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle.key(),
            ctx.accounts.config.oracle,
            DistributorError::Unauthorized
        );
        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(Vault::LEN);
        let available = vault_balance.saturating_sub(rent);
        require!(total_amount <= available, DistributorError::InsufficientVault);

        let p = &mut ctx.accounts.period;
        p.period_id = period_id;
        p.merkle_root = merkle_root;
        p.total_amount = total_amount;
        p.claimed_amount = 0;
        p.bump = ctx.bumps.period;
        Ok(())
    }
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub bump: u8,
}
impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, payer = admin, space = Config::LEN,
        seeds = [b"config"], bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetOracle<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[account]
pub struct Vault {
    pub bump: u8,
}
impl Vault {
    pub const LEN: usize = 8 + 1;
}

#[account]
pub struct Period {
    pub period_id: u64,
    pub merkle_root: [u8; 32],
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub bump: u8,
}
impl Period {
    pub const LEN: usize = 8 + 8 + 32 + 8 + 8 + 1;
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(init, payer = admin, space = Vault::LEN, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(period_id: u64)]
pub struct PublishPeriod<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"vault"], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init, payer = oracle, space = Period::LEN,
        seeds = [b"period", period_id.to_le_bytes().as_ref()], bump
    )]
    pub period: Account<'info, Period>,
    #[account(mut)]
    pub oracle: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum DistributorError {
    #[msg("unauthorized")]
    Unauthorized,
    #[msg("solvency: total exceeds vault balance")]
    InsufficientVault,
    #[msg("invalid merkle proof")]
    InvalidProof,
    #[msg("already claimed")]
    AlreadyClaimed,
    #[msg("period total exceeded")]
    PeriodTotalExceeded,
}
