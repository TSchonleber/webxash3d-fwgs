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
